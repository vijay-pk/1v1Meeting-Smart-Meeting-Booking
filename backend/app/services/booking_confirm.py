"""
Side effects of confirming a booking: the Google Calendar event + Meet link, the host
notification, the reminder, and the confirmation emails.

Extracted verbatim from the payment /verify path so a FREE student booking (no Razorpay) runs
exactly the same confirmation, with no second copy of this logic to drift. The caller is
responsible for the money/lock state *before* this runs; this helper only does the post-confirm
side effects and commits them. It never raises for an email/calendar outage -- the booking is
already confirmed by the time it runs.
"""
import logging
import re

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import Booking, User, GoogleConnection, Notification
from app.services.google_calendar import create_calendar_event_with_meet
from app.services.email_service import (
    send_booking_confirmation_email,
    send_admin_new_booking_notification,
)

logger = logging.getLogger(__name__)


async def confirm_booking_side_effects(db: Session, booking: Booking, admin: User) -> str | None:
    """
    Creates the calendar event/Meet link (idempotent via booking.google_event_id), writes the
    host notification, commits, schedules the reminder, and emails client + host. Returns the
    Meet link (or None). Used by both paid /verify and the free student booking path.
    """
    meet_link = None
    g_conn = (
        db.query(GoogleConnection)
        .filter(GoogleConnection.admin_id == admin.id, GoogleConnection.connection_status == "connected")
        .first()
    )
    if booking.google_event_id:
        meet_link = booking.google_meet_link
        calendar_error = None
    elif g_conn and g_conn.encrypted_refresh_token:
        session_title = booking.meeting_type.title if booking.meeting_type else "Mentorship Call"
        event_res = await create_calendar_event_with_meet(
            encrypted_refresh_token=g_conn.encrypted_refresh_token,
            title=f"{session_title} — {booking.client_name} & {admin.name}",
            description=f"1-to-1 session on BookMyMeet.\nAttendee: {booking.client_name} ({booking.client_email})\nNotes: {booking.notes or 'None'}",
            start_time_iso=booking.start_time,
            end_time_iso=booking.end_time,
            calendar_id=g_conn.calendar_id or "primary",
            idempotency_key=f"bmm_{booking.id}",
            client_name=booking.client_name,
            client_email=booking.client_email,
        )
        booking.google_event_id = event_res.get("event_id")
        meet_link = event_res.get("meet_link")
        calendar_error = event_res.get("error")
        space_name = event_res.get("space_name")
        if not space_name and meet_link:
            m = re.search(r"meet\.google\.com/([a-zA-Z0-9-]+)", meet_link)
            if m:
                space_name = f"spaces/{m.group(1)}"
        booking.google_meet_space_id = space_name
        booking.termination_status = "pending" if meet_link else "not_applicable"
        booking.termination_error = None
        booking.terminated_at = None
        booking.termination_retries = 0
    else:
        meet_link = None
        calendar_error = "not_connected"
        booking.google_meet_space_id = None
        booking.termination_status = "not_applicable"
        booking.termination_error = None
        booking.terminated_at = None
        booking.termination_retries = 0

    booking.google_meet_link = meet_link

    db.add(Notification(
        admin_id=admin.id,
        type="new_booking",
        title=f"New Booking: {booking.client_name}",
        message=f"{booking.client_name} booked {booking.meeting_type.title if booking.meeting_type else 'Session'} for {booking.start_time}.",
        booking_id=booking.id,
    ))
    if calendar_error:
        db.add(Notification(
            admin_id=admin.id,
            type="calendar_failed",
            title="Action needed: no meeting link was created",
            message=(
                f"The booking for {booking.client_name} on {booking.start_time} is confirmed, "
                f"but the Google Calendar event could not be created ({calendar_error}). Send "
                f"the client a meeting link, and reconnect Google Calendar in Settings if the "
                f"problem persists."
            ),
            booking_id=booking.id,
        ))

    db.commit()

    # Reminder — after the commit, never fatal (the worker also backfills missing ones).
    try:
        from app.services.reminders import ensure_reminder
        ensure_reminder(db, booking)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Could not schedule the reminder for booking %s", booking.id)

    # Confirmation emails — client + host, each non-fatal.
    session_title = booking.meeting_type.title if booking.meeting_type else "1:1 Session"
    duration_minutes = booking.meeting_type.duration_minutes if booking.meeting_type else 30
    reschedule_url = (
        f"{settings.APP_URL.rstrip('/')}/booking/reschedule/{booking.reschedule_token}"
        if booking.reschedule_token else None
    )
    try:
        await send_booking_confirmation_email(
            to_email=booking.client_email,
            client_name=booking.client_name,
            admin_name=admin.name if admin else "your host",
            session_title=session_title,
            start_time=booking.start_time,
            duration_minutes=duration_minutes,
            meet_link=meet_link,
            reschedule_url=reschedule_url,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Client confirmation email failed for booking %s", booking.public_id)
    if admin and admin.email:
        try:
            await send_admin_new_booking_notification(
                admin_email=admin.email,
                admin_name=admin.name,
                client_name=booking.client_name,
                client_email=booking.client_email,
                session_title=session_title,
                start_time=booking.start_time,
                meet_link=meet_link,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Admin booking email failed for booking %s", booking.public_id)

    return meet_link
