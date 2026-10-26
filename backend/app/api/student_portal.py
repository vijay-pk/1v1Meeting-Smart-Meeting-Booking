"""
Student-facing API. Every endpoint requires a signed-in student whose temporary password has
been replaced (get_current_student). Students book the single Super Admin as host, reusing the
same availability engine, slot locks and conflict index as every other booking -- there is no
separate calendar. Free bookings skip Razorpay entirely; paid bookings reuse the Super Admin's
own Razorpay account and the existing /payments/verify to confirm.
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.api.deps import get_current_student
from app.api.availability import get_available_slots, get_slot_counts
from app.models.models import (
    User, Session as SessionModel, Booking, SlotLock, RazorpayConnection, Payment,
    StudentPolicyAcceptance, GoogleConnection,
)
from app.schemas.schemas import (
    StudentFreeBookingRequest, StudentPaidOrderRequest, StudentPolicyAcceptRequest,
)
from app.services import student_allowance
from app.services.student_availability_diagnosis import diagnose
from app.services.booking_slots import as_utc, expire_abandoned_bookings, is_occupying
from app.services.booking_confirm import confirm_booking_side_effects
from app.services.razorpay_service import (
    create_razorpay_order, RazorpayConfigurationError, RazorpayOrderError,
)
from app.core.security import SecretDecryptionError
from app.services.platform_settings import get_student_policy

logger = logging.getLogger(__name__)
router = APIRouter()

SIMULATED_PROVIDER = "razorpay_simulated"
REAL_PROVIDER = "razorpay"


def get_student_host(db: Session) -> User:
    """The single Super Admin every student books against."""
    host = (
        db.query(User)
        .filter(User.role == "super_admin", User.status == "ACTIVE")
        .order_by(User.created_at.asc())
        .first()
    )
    if not host:
        raise HTTPException(status_code=503, detail="Student bookings are not available yet.")
    return host


def _student_session(db: Session, host: User, session_id: str, *, free: bool) -> SessionModel:
    want = "student_free" if free else "student_paid"
    s = (
        db.query(SessionModel)
        .filter(
            SessionModel.id == session_id,
            SessionModel.admin_id == host.id,
            SessionModel.audience == want,
            SessionModel.is_active == True,  # noqa: E712
        )
        .first()
    )
    if not s:
        raise HTTPException(status_code=404, detail="That meeting type is not available.")
    return s


def _consume_lock(db: Session, host: User, lock_id: str, start_time: str) -> SlotLock:
    now_utc = datetime.now(timezone.utc)
    lock = db.query(SlotLock).filter(SlotLock.id == lock_id).first()
    if (
        not lock or lock.status != "active" or lock.admin_id != host.id
        # expires_at is stored naive-UTC (timestamp without time zone); normalise before comparing.
        or lock.start_time != start_time or as_utc(lock.expires_at) <= now_utc
    ):
        raise HTTPException(status_code=409, detail="Your hold on this slot has expired. Please pick the time again.")
    return lock


def _conflict_check(db: Session, host: User, start_time: str, exclude_id: str | None = None):
    now_utc = datetime.now(timezone.utc)
    expire_abandoned_bookings(db, admin_id=host.id, start_time=start_time, now_utc=now_utc)
    candidates = (
        db.query(Booking)
        .filter(
            Booking.admin_id == host.id,
            Booking.start_time == start_time,
            Booking.status.in_(["confirmed", "pending_payment"]),
        )
        .all()
    )
    if any(is_occupying(b, now_utc) for b in candidates if b.id != exclude_id):
        raise HTTPException(status_code=409, detail="This slot is no longer available. Please pick another time.")


_WALL_FMT = "%Y-%m-%dT%H:%M:00Z"


async def _validate_student_slot(
    db: Session, host: User, session_obj: SessionModel, lock: SlotLock, start_time: str, end_time: str,
) -> str:
    """
    The backend is the authority on whether a slot can be booked; the page only displays.

    Re-runs the real availability engine on the exact slot (working hours, the type's own hours,
    leave, notice and horizon, buffers, existing client + student bookings, other holds, and the
    host's Google Calendar), requires the requested end to match the type's duration, and
    returns the server-computed end time. Raises 400 / 409 / 503 and leaves the transaction
    rolled back (so the student's hold is still active) when the slot cannot be booked.

    The student's OWN hold is set to 'validating' for the duration of the check, because the
    engine counts every ACTIVE hold as busy -- including the one this student is about to spend.
    Competing holds from other students stay active and still block.
    """
    try:
        start = datetime.strptime(start_time, _WALL_FMT)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="That start time is not valid.")
    expected_end = (start + timedelta(minutes=session_obj.duration_minutes)).strftime(_WALL_FMT)
    if end_time != expected_end:
        raise HTTPException(status_code=400, detail="The selected time does not match this session's duration.")

    lock.status = "validating"
    db.flush()
    res = await get_available_slots(
        admin_id=host.id, username=None, session_id=session_obj.id, date_str=start_time[:10], db=db,
    )
    if res.get("calendar_error"):
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Calendar sync is unavailable, so booking is paused. Please try again shortly.",
        )
    if not any(s["start_time_iso"] == start_time for s in res.get("available_slots", [])):
        db.rollback()
        raise HTTPException(status_code=409, detail="This slot is no longer available. Please pick another time.")
    return expected_end


def _new_booking(student: User, host: User, session_obj: SessionModel, start_time, end_time, category, status, payment_status):
    return Booking(
        public_id=f"BK-{datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}",
        admin_id=host.id,
        meeting_type_id=session_obj.id,
        student_id=student.id,
        category=category,
        client_name=student.name,
        client_email=student.email,
        start_time=start_time,
        end_time=end_time,
        # The zone the slot engine computed in -- the host's -- not a hardcoded one.
        timezone=settings.BUSINESS_TIMEZONE,
        status=status,
        payment_status=payment_status,
        attendance_status="pending",
        cancellation_token=secrets.token_hex(16),
        reschedule_token=secrets.token_hex(16),
    )


@router.get("/me")
def student_me(student: User = Depends(get_current_student), db: Session = Depends(get_db)):
    host = get_student_host(db)
    summ = student_allowance.summary(db, student.id)
    policy = get_student_policy(db)
    accepted = (
        db.query(StudentPolicyAcceptance)
        .filter(
            StudentPolicyAcceptance.student_id == student.id,
            StudentPolicyAcceptance.policy_version == policy["version"],
        )
        .first()
        is not None
    )
    return {
        "id": student.id,
        "name": student.name,
        "email": student.email,
        "host_admin_id": host.id,
        "allowance": summ,
        "policy_version": policy["version"],
        "policy_accepted": accepted,
    }


@router.get("/meeting-types")
def student_meeting_types(student: User = Depends(get_current_student), db: Session = Depends(get_db)):
    host = get_student_host(db)
    rows = (
        db.query(SessionModel)
        .filter(
            SessionModel.admin_id == host.id,
            SessionModel.is_active == True,  # noqa: E712
            SessionModel.audience.in_(["student_free", "student_paid"]),
        )
        .order_by(SessionModel.sort_order.asc(), SessionModel.created_at.asc())
        .all()
    )
    return {
        "host_admin_id": host.id,
        "available": student_allowance.available(db, student.id),
        "free": [_session_out(s) for s in rows if s.audience == "student_free"],
        "paid": [_session_out(s) for s in rows if s.audience == "student_paid"],
    }


def _session_out(s: SessionModel) -> dict:
    return {
        "id": s.id, "title": s.title, "description": s.description,
        "duration_minutes": s.duration_minutes, "price": s.price, "currency": s.currency,
        "audience": s.audience,
    }


@router.get("/availability")
async def student_availability(
    session_id: str = Query(...),
    days: int = Query(30, ge=1, le=31),
    date: Optional[str] = Query(None, pattern="^[0-9]{4}-[0-9]{2}-[0-9]{2}$"),
    student: User = Depends(get_current_student),
    db: Session = Depends(get_db),
):
    """
    Everything the booking page needs in ONE request: per-day counts across the booking horizon,
    the earliest date that really has a slot, and that date's slots (or `date`'s, if it still has
    some). It reuses the public slot engine and the one-FreeBusy-call slot-counts, so a student
    sees exactly what a client of the same host would -- there is no second scheduling system.

    An unreachable calendar is reported as calendar.status == "error" (the page must show an
    error, never "no availability"); a host with no connected calendar is "disconnected", i.e.
    external conflicts were NOT checked, and the page says so.
    """
    host = get_student_host(db)
    session_obj = (
        db.query(SessionModel)
        .filter(
            SessionModel.id == session_id,
            SessionModel.admin_id == host.id,
            SessionModel.audience.in_(["student_free", "student_paid"]),
            SessionModel.is_active == True,  # noqa: E712
        )
        .first()
    )
    if not session_obj:
        raise HTTPException(status_code=404, detail="That meeting type is not available.")

    # Never search past what the type allows booking ahead (the engine enforces it per day too).
    horizon = max(1, min(days, (session_obj.max_advance_days or 30) + 1))
    counts = await get_slot_counts(admin_id=host.id, username=None, session_id=session_obj.id, days=horizon, db=db)
    day_rows = counts["days"]
    calendar_error = any(d.get("calendar_error") for d in day_rows)

    usable = [d for d in day_rows if d["count"] > 0 and not d.get("calendar_error")]
    first_available = usable[0]["date"] if usable else None
    selected = date if (date and any(d["date"] == date for d in usable)) else first_available

    slots = []
    if selected and not calendar_error:
        res = await get_available_slots(
            admin_id=host.id, username=None, session_id=session_obj.id, date_str=selected, db=db,
        )
        if res.get("calendar_error"):
            calendar_error = True
        else:
            slots = res.get("available_slots", [])

    connected = (
        db.query(GoogleConnection)
        .filter(
            GoogleConnection.admin_id == host.id,
            GoogleConnection.connection_status == "connected",
            GoogleConnection.encrypted_refresh_token.isnot(None),
        )
        .first()
        is not None
    )
    status = "error" if calendar_error else ("connected" if connected else "disconnected")

    # Nothing bookable and the calendar was readable: say WHICH saved setting is responsible
    # (no working hours, hours that never overlap, a session longer than any window) instead of
    # leaving an unexplained empty page. None means the setup is sound and the days are full.
    diagnosis = None
    if not first_available and status != "error":
        found = diagnose(db, host.id, session_obj)
        if found:
            diagnosis = {"code": found["code"], "message": found["message"]}

    return {
        "timezone": counts.get("timezone") or settings.BUSINESS_TIMEZONE,
        "calendar": {"status": status, "checked": status == "connected"},
        "horizon_days": horizon,
        "session": {"id": session_obj.id, "title": session_obj.title, "duration_minutes": session_obj.duration_minutes},
        "days": [{"date": d["date"], "count": d["count"]} for d in day_rows],
        "first_available_date": first_available,
        "selected_date": selected,
        "requested_date_unavailable": bool(date) and selected != date,
        "slots": slots,
        "diagnosis": diagnosis,
    }


@router.post("/bookings/free")
async def create_free_booking(body: StudentFreeBookingRequest, student: User = Depends(get_current_student), db: Session = Depends(get_db)):
    host = get_student_host(db)
    session_obj = _student_session(db, host, body.session_id, free=True)

    if student_allowance.available(db, student.id) <= 0:
        raise HTTPException(status_code=402, detail="You have no free meetings left. Choose a paid session to continue.")

    lock = _consume_lock(db, host, body.lock_id, body.start_time)
    end_time = await _validate_student_slot(db, host, session_obj, lock, body.start_time, body.end_time)
    _conflict_check(db, host, body.start_time)

    booking = _new_booking(student, host, session_obj, body.start_time, end_time,
                           category="student_free", status="confirmed", payment_status="free")
    db.add(booking)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This slot has already been booked. Please select another time.")
    lock.status = "confirmed"
    db.commit()

    meet_link = await confirm_booking_side_effects(db, booking, host)
    return {
        "status": "confirmed",
        "booking_id": booking.id,
        "public_id": booking.public_id,
        "google_meet_link": meet_link,
        "meeting_link_pending": meet_link is None,
    }


@router.post("/bookings/paid-order")
async def create_paid_order(body: StudentPaidOrderRequest, student: User = Depends(get_current_student), db: Session = Depends(get_db)):
    """
    Opens a Razorpay order for a paid student session on the Super Admin's own account. The
    browser then pays and calls the existing POST /payments/verify (by booking_id) to confirm --
    no separate verify path, no second signature check. The booking carries category
    'student_paid' + student_id so it never touches the free allowance.
    """
    host = get_student_host(db)
    session_obj = _student_session(db, host, body.session_id, free=False)

    rp = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == host.id).first()
    if rp and rp.connection_status == "connected":
        key_id, enc_secret = rp.key_id, rp.encrypted_key_secret
        simulated = False
    elif settings.PAYMENTS_ALLOW_SIMULATION:
        key_id, enc_secret, simulated = "rzp_test_simulated_key", "", True
    else:
        raise HTTPException(status_code=503, detail="Paid student bookings are not available yet.")

    lock = _consume_lock(db, host, body.lock_id, body.start_time)
    end_time = await _validate_student_slot(db, host, session_obj, lock, body.start_time, body.end_time)
    _conflict_check(db, host, body.start_time)

    booking = _new_booking(student, host, session_obj, body.start_time, end_time,
                           category="student_paid", status="pending_payment", payment_status="pending")
    db.add(booking)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This slot has already been booked. Please select another time.")
    lock.status = "consumed"

    try:
        rp_order = await create_razorpay_order(
            key_id=key_id, encrypted_key_secret=enc_secret,
            amount_in_paise=session_obj.price, currency=session_obj.currency,
            receipt=f"rcpt_{booking.id[:8]}",
        )
    except RazorpayConfigurationError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except RazorpayOrderError as exc:
        db.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except SecretDecryptionError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Payment configuration error. Please contact support.") from exc

    db.add(Payment(
        booking_id=booking.id, admin_id=host.id,
        provider=SIMULATED_PROVIDER if (simulated or rp_order.get("simulated")) else REAL_PROVIDER,
        order_id=rp_order["id"], amount=session_obj.price, currency=session_obj.currency, status="created",
    ))
    db.commit()

    return {
        "order_id": rp_order["id"],
        "amount": session_obj.price,
        "currency": session_obj.currency,
        "key_id": key_id,
        "booking_id": booking.id,
    }


@router.get("/policy")
def student_policy(student: User = Depends(get_current_student), db: Session = Depends(get_db)):
    policy = get_student_policy(db)
    accepted = (
        db.query(StudentPolicyAcceptance)
        .filter(
            StudentPolicyAcceptance.student_id == student.id,
            StudentPolicyAcceptance.policy_version == policy["version"],
        )
        .first()
        is not None
    )
    return {**policy, "accepted": accepted}


@router.post("/policy/accept")
def accept_policy(body: StudentPolicyAcceptRequest, student: User = Depends(get_current_student), db: Session = Depends(get_db)):
    policy = get_student_policy(db)
    if body.policy_version != policy["version"]:
        raise HTTPException(status_code=409, detail="The policy has been updated. Please re-read it.")
    exists = (
        db.query(StudentPolicyAcceptance)
        .filter(
            StudentPolicyAcceptance.student_id == student.id,
            StudentPolicyAcceptance.policy_version == policy["version"],
        )
        .first()
    )
    if not exists:
        db.add(StudentPolicyAcceptance(student_id=student.id, policy_version=policy["version"]))
        db.commit()
    return {"accepted": True, "policy_version": policy["version"]}


@router.post("/bookings/{booking_id}/cancel")
def cancel_my_booking(booking_id: str, student: User = Depends(get_current_student), db: Session = Depends(get_db)):
    """
    A student cancels their own booking, up to 24h before it starts. A free cancellation never
    consumes the allowance (attendance stays pending, so the derived count is unchanged) and
    releases the slot for rebooking. Paid refunds are handled out of band -- this only cancels.
    """
    booking = (
        db.query(Booking)
        .filter(Booking.id == booking_id, Booking.student_id == student.id)
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status == "cancelled":
        return {"id": booking.id, "status": "cancelled"}
    if booking.status not in ("confirmed", "pending_payment"):
        raise HTTPException(status_code=409, detail="This booking can no longer be cancelled.")

    from app.services.student_rules import within_change_window
    if not within_change_window(booking.start_time):
        raise HTTPException(
            status_code=403,
            detail="Cancellation closes 24 hours before the session. Please contact the host.",
        )

    booking.status = "cancelled"
    booking.termination_status = "cancelled"
    # Release any active hold on the vacated slot so it becomes bookable again.
    db.query(SlotLock).filter(
        SlotLock.admin_id == booking.admin_id,
        SlotLock.start_time == booking.start_time,
        SlotLock.status == "active",
    ).update({SlotLock.status: "released"}, synchronize_session=False)
    db.commit()
    return {"id": booking.id, "status": "cancelled"}


@router.get("/recordings")
def my_recordings(student: User = Depends(get_current_student), db: Session = Depends(get_db)):
    """
    This student's recordings. One entry per past meeting that had a Meet link, with an honest
    status (unsupported until retrieval is configured). Never fabricates a recording.
    """
    from app.services.meeting_recording import recording_capability, list_student_recordings

    # Scoped to this student's own bookings inside list_student_recordings (student_id filter).
    return {
        "capability": recording_capability(db),
        "recordings": list_student_recordings(db, student.id, confirmed_only=True),
    }


@router.get("/recordings/{booking_id}/play")
def play_recording(booking_id: str, student: User = Depends(get_current_student), db: Session = Depends(get_db)):
    """
    Returns a playable link only when a recording is genuinely available and belongs to this
    student. Private by design -- no public Drive URL. Until retrieval is configured this is a
    clear 404 with status, never a fake link.
    """
    from app.models.models import MeetingRecording
    from app.services.recording_sim import is_simulated, simulation_allowed, TEST_LABEL

    row = (
        db.query(MeetingRecording)
        .join(Booking, Booking.id == MeetingRecording.booking_id)
        .filter(MeetingRecording.booking_id == booking_id, Booking.student_id == student.id)
        .first()
    )
    # Not found, someone else's, or not available: the same 404, so existence never leaks.
    if not row or row.status != "available":
        raise HTTPException(status_code=404, detail="No recording is available for this meeting.")
    if is_simulated(row):
        if not simulation_allowed():
            raise HTTPException(status_code=404, detail="No recording is available for this meeting.")
        # A TEST entry has no video. Say so plainly and never return a URL.
        return {"simulated": True, "playable": False, "message": TEST_LABEL}
    # A real recording: hand back a short-lived signed link to the backend stream. No Google
    # token and no Drive URL is ever returned.
    if not row.drive_file_id:
        raise HTTPException(status_code=404, detail="No recording is available for this meeting.")
    from app.services.recording_google import make_stream_token, STREAM_TOKEN_TTL_SECONDS

    return {
        "simulated": False,
        "playable": True,
        "stream_path": f"/student/recordings/{booking_id}/stream?t={make_stream_token(student.id, booking_id)}",
        "expires_in": STREAM_TOKEN_TTL_SECONDS,
    }


@router.get("/bookings")
def my_bookings(student: User = Depends(get_current_student), db: Session = Depends(get_db)):
    """This student's own bookings (free + paid), newest first, for the My Meetings page."""
    rows = (
        db.query(Booking)
        .filter(Booking.student_id == student.id)
        .order_by(Booking.start_time.desc())
        .all()
    )
    return [
        {
            "id": b.id,
            "public_id": b.public_id,
            "session_title": b.meeting_type.title if b.meeting_type else "Session",
            "duration_minutes": b.meeting_type.duration_minutes if b.meeting_type else None,
            "category": b.category,
            "start_time": b.start_time,
            "end_time": b.end_time,
            "timezone": b.timezone,
            "status": b.status,
            "attendance_status": b.attendance_status,
            "payment_status": b.payment_status,
            "google_meet_link": b.google_meet_link,
            "reschedule_token": b.reschedule_token,
            "cancellation_token": b.cancellation_token,
        }
        for b in rows
    ]
