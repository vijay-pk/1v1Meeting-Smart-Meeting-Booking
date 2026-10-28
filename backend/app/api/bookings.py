import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from sqlalchemy.exc import IntegrityError
from app.core.config import settings
from app.models.models import User, Session as SessionModel, Booking, SlotLock, GoogleConnection
from app.schemas.schemas import SlotLockRequest, SlotLockResponse, BookingResponse, RescheduleRequest
from app.api.deps import get_current_admin
from app.services.booking_slots import expire_abandoned_bookings, is_occupying
from app.services.google_calendar import update_calendar_event_time
from app.services.email_service import send_booking_rescheduled_email
from app.services.meeting_termination import cancel_termination_job, schedule_termination_job, phase_fields

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/hold-slot", response_model=SlotLockResponse)
def hold_slot(req: SlotLockRequest, db: Session = Depends(get_db)):
    """
    Acquires a 10-minute temporary slot hold to prevent double-booking during checkout.
    """
    now_utc = datetime.now(timezone.utc)

    # 1. Check if an active hold already exists for this admin & timeframe
    existing_lock = (
        db.query(SlotLock)
        .filter(
            SlotLock.admin_id == req.admin_id,
            SlotLock.status == "active",
            SlotLock.expires_at > now_utc,
            SlotLock.start_time == req.start_time
        )
        .first()
    )

    if existing_lock:
        if existing_lock.locked_by_session == req.session_fingerprint:
            # Refresh expiry for same user
            existing_lock.expires_at = now_utc + timedelta(minutes=10)
            db.commit()
            return {
                "lock_id": existing_lock.id,
                "expires_at": existing_lock.expires_at.isoformat(),
                "status": "active"
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This slot is currently held by another user. Please choose another time or wait a few minutes."
            )

    # 2. Is the slot already taken by a booking?
    #
    # Confirmed always counts; a checkout in progress counts while its window is open. An
    # abandoned one is released here rather than blocking the slot forever -- the same rule
    # the availability engine applies, so the picker and the hold never disagree about what
    # is free.
    expire_abandoned_bookings(
        db, admin_id=req.admin_id, start_time=req.start_time, now_utc=now_utc
    )
    candidates = (
        db.query(Booking)
        .filter(
            Booking.admin_id == req.admin_id,
            Booking.start_time == req.start_time,
            Booking.status.in_(["confirmed", "pending_payment"])
        )
        .all()
    )
    existing_booking = next((b for b in candidates if is_occupying(b, now_utc)), None)
    if existing_booking:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This slot is no longer available. Please choose another time."
        )

    # 3. Create new 10-minute temporary lock
    lock = SlotLock(
        admin_id=req.admin_id,
        session_id=req.session_id,
        start_time=req.start_time,
        end_time=req.end_time,
        locked_by_session=req.session_fingerprint,
        expires_at=now_utc + timedelta(minutes=10),
        status="active"
    )
    db.add(lock)
    db.commit()
    db.refresh(lock)

    return {
        "lock_id": lock.id,
        "expires_at": lock.expires_at.isoformat(),
        "status": "active"
    }

@router.post("/release-hold/{lock_id}")
def release_hold(
    lock_id: str,
    session_fingerprint: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Releases a hold the caller owns.

    This used to release any lock by id with no ownership check at all, so anyone holding a
    lock id could drop another client's hold mid-checkout. The fingerprint is the same value
    that took the hold, and the endpoint stays public because the booking flow has no login.

    Always answers 200: a hold that is already gone, or was never the caller's, is not
    something a client can act on, and saying which it was would confirm that a given lock id
    exists.
    """
    lock = db.query(SlotLock).filter(SlotLock.id == lock_id).first()
    if lock and lock.status == "active":
        if session_fingerprint is None or lock.locked_by_session == session_fingerprint:
            lock.status = "released"
            db.commit()
    return {"message": "Hold released successfully"}

@router.get("/my-bookings")
def get_admin_bookings(
    status_filter: Optional[str] = None,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    query = db.query(Booking).filter(Booking.admin_id == current_admin.id)
    if status_filter:
        query = query.filter(Booking.status == status_filter)

    bookings = query.order_by(Booking.start_time.desc()).all()
    results = []
    for b in bookings:
        results.append({
            "id": b.id,
            "public_id": b.public_id,
            "client_name": b.client_name,
            "client_email": b.client_email,
            "client_phone": b.client_phone,
            "start_time": b.start_time,
            "end_time": b.end_time,
            "timezone": b.timezone,
            "status": b.status,
            "payment_status": b.payment_status,
            "session_title": b.meeting_type.title if b.meeting_type else "Mentorship Call",
            "duration_minutes": b.meeting_type.duration_minutes if b.meeting_type else 30,
            "price": b.meeting_type.price if b.meeting_type else 0,
            "google_meet_link": b.google_meet_link,
            "google_meet_space_id": b.google_meet_space_id,
            "termination_status": b.termination_status,
            "termination_error": b.termination_error,
            "terminated_at": (
                (b.terminated_at if b.terminated_at.tzinfo else b.terminated_at.replace(tzinfo=timezone.utc)).isoformat()
                if b.terminated_at else None
            ),
            "grace_notified_at": (
                (b.grace_notified_at if b.grace_notified_at.tzinfo else b.grace_notified_at.replace(tzinfo=timezone.utc)).isoformat()
                if b.grace_notified_at else None
            ),
            # Stored as naive UTC; say so, or the browser reads it as local time.
            "created_at": (
                (b.created_at if b.created_at.tzinfo else b.created_at.replace(tzinfo=timezone.utc)).isoformat()
                if b.created_at else None
            )
        })
    return results

@router.post("/{booking_id}/cancel")
def cancel_my_booking(
    booking_id: str,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    Cancels one of the signed-in admin's own bookings.

    Ownership is re-checked here rather than trusted from the request, so an admin can never
    cancel someone else's booking by id. The slot becomes bookable again because the slot
    engine only counts "confirmed" and "pending_payment" bookings.
    """
    booking = (
        db.query(Booking)
        .filter(Booking.id == booking_id, Booking.admin_id == current_admin.id)
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    if booking.status == "cancelled":
        return {"id": booking.id, "status": booking.status}

    booking.status = "cancelled"
    cancel_termination_job(booking)

    # Free any active hold on this slot so the time is immediately bookable again.
    db.query(SlotLock).filter(
        SlotLock.admin_id == current_admin.id,
        SlotLock.start_time == booking.start_time,
        SlotLock.status == "active",
    ).update({SlotLock.status: "released"}, synchronize_session=False)

    db.commit()
    return {"id": booking.id, "status": booking.status}


def _hide_action_tokens(booking: Booking, is_expired: bool, now) -> bool:
    """Cancel/Reschedule links are not offered for a finished, cancelled or (student) locked booking."""
    if is_expired or booking.status in ("cancelled", "completed"):
        return True
    from app.services.meeting_termination import lifecycle_status
    if lifecycle_status(booking, now) == "completed":
        return True
    if booking.category in ("student_free", "student_paid"):
        from app.services.student_rules import change_info
        return not change_info(booking, now)["can_change"]
    return False


@router.get("/public/{public_id}")
def get_public_booking(public_id: str, db: Session = Depends(get_db)):
    booking = db.query(Booking).filter(Booking.public_id == public_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    admin = booking.admin
    from app.services.meeting_termination import (
        TERMINAL_ENDED,
        booking_end_utc,
        booking_termination_utc,
        format_localized_termination_time,
        _utc_now,
    )

    now = _utc_now()
    end_utc = booking_end_utc(booking.end_time)
    term_utc = booking_termination_utc(booking.end_time)

    # Has the grace period elapsed, or is the conference already ended?
    is_expired = bool(
        booking.termination_status in TERMINAL_ENDED or (term_utc and term_utc <= now)
    )

    # Are we currently within the wrap-up grace period?
    is_grace_period = bool(
        not is_expired
        and end_utc
        and end_utc <= now
        and (term_utc and now < term_utc)
    )

    grace_remaining_seconds = 0
    if is_grace_period and term_utc:
        grace_remaining_seconds = max(0, int((term_utc - now).total_seconds()))

    localized_term_time = format_localized_termination_time(booking.end_time, booking.timezone)

    return {
        "public_id": booking.public_id,
        "client_name": booking.client_name,
        "client_email": booking.client_email,
        "admin_name": admin.name if admin else "Mentor",
        "session_title": booking.meeting_type.title if booking.meeting_type else "1:1 Session",
        "duration_minutes": booking.meeting_type.duration_minutes if booking.meeting_type else 30,
        "start_time": booking.start_time,
        "end_time": booking.end_time,
        "timezone": booking.timezone,
        "status": booking.status,
        "payment_status": booking.payment_status,
        # Facts the confirmation page states to the visitor. It used to assume them (that money
        # was paid, that invitations were sent), which was untrue for a free student session.
        "category": booking.category or "client",
        "amount": booking.payment.amount if booking.payment else 0,
        "currency": (
            (booking.payment.currency if booking.payment else None)
            or (booking.meeting_type.currency if booking.meeting_type else None)
            or "INR"
        ),
        # Whether this site can send email at all; a confirmation is only promised when it can.
        "email_enabled": settings.EMAIL_ENABLED,
        "google_meet_link": None if is_expired else booking.google_meet_link,
        "is_expired": is_expired,
        "is_grace_period": is_grace_period,
        "grace_remaining_seconds": grace_remaining_seconds,
        "grace_termination_time": localized_term_time,
        "termination_status": booking.termination_status,
        **phase_fields(booking, now),
        "grace_notified_at": (
            (booking.grace_notified_at if booking.grace_notified_at.tzinfo else booking.grace_notified_at.replace(tzinfo=timezone.utc)).isoformat()
            if booking.grace_notified_at else None
        ),
        # The booking's owner reached this by its public id (the link they were given), so the
        # action tokens belong to them -- exposing them here is what makes the Reschedule and
        # Cancel buttons on the confirmation screen work. Not shown once the meeting is over.
        "reschedule_token": None if _hide_action_tokens(booking, is_expired, now) else booking.reschedule_token,
        "cancellation_token": None if _hide_action_tokens(booking, is_expired, now) else booking.cancellation_token,
    }


def _reschedule_booking_payload(booking: Booking) -> dict:
    """Shape a booking for the reschedule page: current time plus the session it is for."""
    mt = booking.meeting_type
    return {
        "id": booking.id,
        "public_id": booking.public_id,
        "admin_id": booking.admin_id,
        "status": booking.status,
        "start_time": booking.start_time,
        "end_time": booking.end_time,
        "timezone": booking.timezone,
        "client_name": booking.client_name,
        "meeting_type_id": booking.meeting_type_id,
        "session_title": mt.title if mt else "1:1 Session",
        "duration_minutes": mt.duration_minutes if mt else 30,
    }


def _refuse_if_over_or_locked(booking: Booking, verb: str) -> None:
    """
    Shared by the token reschedule/cancel endpoints: a session whose scheduled end has passed
    can no longer be changed by anyone holding a link, and a student booking is locked inside the
    24-hour window. The current authoritative time is read here, on every request.
    """
    from app.services.meeting_termination import booking_end_utc, _utc_now
    end = booking_end_utc(booking.end_time)
    if end is not None and _utc_now() >= end:
        raise HTTPException(status_code=409, detail=f"This session has already taken place, so it can no longer be changed.")
    if booking.category in ("student_free", "student_paid"):
        from app.services.student_rules import within_change_window
        if not within_change_window(booking.start_time):
            raise HTTPException(
                status_code=403,
                detail=f"{verb} closes 24 hours before the session. Please contact the host.",
            )


@router.get("/reschedule/{token}")
def get_booking_for_reschedule(token: str, db: Session = Depends(get_db)):
    """
    Resolves a reschedule link to its booking. Public (the booking flow has no login); the
    token is the secret. A booking that is cancelled, completed or past its time cannot be
    rescheduled, and says so rather than letting someone pick a new slot that will be refused.
    """
    booking = db.query(Booking).filter(Booking.reschedule_token == token).first()
    if not booking:
        raise HTTPException(status_code=404, detail="This reschedule link is invalid or has expired.")
    if booking.status not in ("confirmed", "pending_payment"):
        raise HTTPException(status_code=409, detail="This booking can no longer be rescheduled.")
    _refuse_if_over_or_locked(booking, "Rescheduling")
    return _reschedule_booking_payload(booking)


@router.post("/reschedule/{token}")
async def reschedule_booking(token: str, req: RescheduleRequest, db: Session = Depends(get_db)):
    """
    Moves a booking to a new slot via its reschedule link.

    The new time is validated the same way a fresh booking is: the slot must be free (the
    partial unique index on (admin_id, start_time) is the final authority, so a race loses
    with a clean 409, not a double booking). The existing Google Calendar event is patched in
    place, keeping the same Meet link, and both parties are emailed the new time. The slot the
    booking is leaving becomes bookable again automatically, because the engine only counts a
    booking at its current start_time.
    """
    booking = db.query(Booking).filter(Booking.reschedule_token == token).first()
    if not booking:
        raise HTTPException(status_code=404, detail="This reschedule link is invalid or has expired.")
    if booking.status not in ("confirmed", "pending_payment"):
        raise HTTPException(status_code=409, detail="This booking can no longer be rescheduled.")

    # Student self-service changes stop 24h before the session. Enforced on the backend so an
    # old email link or a direct API call cannot slip past the deadline. Client bookings are
    # unaffected (no window) -- the rule applies only to student-category bookings.
    _refuse_if_over_or_locked(booking, "Rescheduling")

    new_start = req.start_time.strip()
    new_end = req.end_time.strip()
    if not new_start or not new_end:
        raise HTTPException(status_code=400, detail="A new start and end time are required.")
    if new_start == booking.start_time:
        raise HTTPException(status_code=400, detail="That is the time the booking is already at.")

    now_utc = datetime.now(timezone.utc)

    # Free the slot being vacated, and check the target slot is not occupied by another
    # booking -- the same occupancy rule the availability engine and hold-slot use.
    expire_abandoned_bookings(db, admin_id=booking.admin_id, start_time=new_start, now_utc=now_utc)
    candidates = (
        db.query(Booking)
        .filter(
            Booking.admin_id == booking.admin_id,
            Booking.start_time == new_start,
            Booking.status.in_(["confirmed", "pending_payment"]),
            Booking.id != booking.id,
        )
        .all()
    )
    if any(is_occupying(b, now_utc) for b in candidates):
        raise HTTPException(status_code=409, detail="That slot is no longer available. Please pick another time.")

    old_start = booking.start_time
    booking.start_time = new_start
    booking.end_time = new_end
    # Move the termination deadline with the meeting: bumps the job generation, so any
    # in-flight worker holding the old schedule cannot write over it, and the old deadline
    # no longer exists.
    schedule_termination_job(booking)
    # The recording follows the same Meet space, but its estimate was measured from the old end.
    from app.models.models import MeetingRecording
    db.query(MeetingRecording).filter(
        MeetingRecording.booking_id == booking.id,
        MeetingRecording.status.in_(["pending", "processing"]),
    ).update({MeetingRecording.estimated_ready_at: None}, synchronize_session=False)

    try:
        db.flush()
    except IntegrityError:
        # The unique index fired: another booking took this exact slot between the check above
        # and here. Roll back to the original time and report the conflict.
        db.rollback()
        raise HTTPException(status_code=409, detail="That slot was just taken. Please pick another time.")

    # Release any active hold left on the slot we just moved away from, so it resells.
    db.query(SlotLock).filter(
        SlotLock.admin_id == booking.admin_id,
        SlotLock.start_time == old_start,
        SlotLock.status == "active",
    ).update({SlotLock.status: "released"}, synchronize_session=False)

    db.commit()

    # Move the calendar event (keeps the same Meet link), after the commit and never fatal.
    calendar_moved = None
    if booking.google_event_id and booking.admin_id:
        g_conn = (
            db.query(GoogleConnection)
            .filter(
                GoogleConnection.admin_id == booking.admin_id,
                GoogleConnection.connection_status == "connected",
            )
            .first()
        )
        if g_conn and g_conn.encrypted_refresh_token:
            try:
                res = await update_calendar_event_time(
                    encrypted_refresh_token=g_conn.encrypted_refresh_token,
                    calendar_id=g_conn.calendar_id or "primary",
                    event_id=booking.google_event_id,
                    start_time_iso=new_start,
                    end_time_iso=new_end,
                )
                calendar_moved = res.get("ok")
            except Exception:  # noqa: BLE001
                logger.exception("Calendar move failed for rescheduled booking %s", booking.public_id)

    # Re-schedule the host reminder onto the new time. ensure_reminder keys on start_time, so
    # the old reminder is left behind (it is skipped when its start_time no longer matches).
    try:
        from app.services.reminders import ensure_reminder

        ensure_reminder(db, booking)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Could not reschedule the reminder for booking %s", booking.public_id)

    # Notify both parties of the new time. Non-fatal.
    admin = booking.admin
    mt = booking.meeting_type
    session_title = mt.title if mt else "1:1 Session"
    duration_minutes = mt.duration_minutes if mt else None
    admin_name = admin.name if admin else "your host"
    try:
        await send_booking_rescheduled_email(
            to_email=booking.client_email,
            recipient_name=booking.client_name,
            other_party=admin_name,
            session_title=session_title,
            new_start_time=new_start,
            duration_minutes=duration_minutes,
            meet_link=booking.google_meet_link,
            is_host=False,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Client reschedule email failed for booking %s", booking.public_id)
    if admin and admin.email:
        try:
            await send_booking_rescheduled_email(
                to_email=admin.email,
                recipient_name=admin_name,
                other_party=booking.client_name,
                session_title=session_title,
                new_start_time=new_start,
                duration_minutes=duration_minutes,
                meet_link=booking.google_meet_link,
                is_host=True,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Host reschedule email failed for booking %s", booking.public_id)

    return {
        "status": "rescheduled",
        "public_id": booking.public_id,
        "start_time": booking.start_time,
        "end_time": booking.end_time,
        "google_meet_link": booking.google_meet_link,
        "calendar_moved": calendar_moved,
    }


def _booking_by_cancel_token(db: Session, token: str) -> Booking:
    booking = db.query(Booking).filter(Booking.cancellation_token == token).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found or this link has expired.")
    return booking


@router.get("/cancel/{token}")
def get_booking_for_cancel(token: str, db: Session = Depends(get_db)):
    """Resolves a cancellation link. The token is the secret; the same rules as POST apply."""
    booking = _booking_by_cancel_token(db, token)
    if booking.status == "cancelled":
        return {**_reschedule_booking_payload(booking), "already_cancelled": True}
    if booking.status not in ("confirmed", "pending_payment"):
        raise HTTPException(status_code=409, detail="This booking can no longer be cancelled.")
    _refuse_if_over_or_locked(booking, "Cancellation")
    return _reschedule_booking_payload(booking)


@router.post("/cancel/{token}")
def cancel_booking_by_token(token: str, db: Session = Depends(get_db)):
    """
    Cancels through the emailed/confirmation-page link. This used to be a direct browser write to
    the database, which skipped every rule: a student could cancel inside the 24-hour window, the
    slot was never released and the Meet termination job was left running. It now goes through
    the same checks as the dashboard.
    """
    booking = _booking_by_cancel_token(db, token)
    if booking.status == "cancelled":
        return {"id": booking.id, "status": "cancelled"}
    if booking.status not in ("confirmed", "pending_payment"):
        raise HTTPException(status_code=409, detail="This booking can no longer be cancelled.")
    _refuse_if_over_or_locked(booking, "Cancellation")

    booking.status = "cancelled"
    cancel_termination_job(booking)
    db.query(SlotLock).filter(
        SlotLock.admin_id == booking.admin_id,
        SlotLock.start_time == booking.start_time,
        SlotLock.status == "active",
    ).update({SlotLock.status: "released"}, synchronize_session=False)
    db.commit()
    return {"id": booking.id, "status": "cancelled"}
