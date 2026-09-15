"""
Server-side "upcoming meeting" reminders to the host of each confirmed booking.

Nothing here runs in a browser. Reminders are rows in `meeting_reminders`, and
`run_due_reminders()` does all the work. It is called by:

* the in-process worker started in main.py's lifespan, every REMINDER_POLL_SECONDS, and
* POST /api/internal/reminders/run, for an external scheduler on hosts that sleep.

Both can run at the same time, on any number of instances, without a duplicate: a reminder
row is unique per (booking, start time) and is claimed with a conditional UPDATE before
anything is sent.

The rules, in one place:
- Only a booking whose status is "confirmed" gets a reminder. Pending payments, failed and
  cancelled bookings, expired holds and deleted bookings never do.
- The lead time is copied from the Super Admin setting when the reminder row is created.
  Changing the setting affects bookings that do not have a row yet, never ones that do.
- A booking whose start_time changed no longer matches its reminder: that row is skipped
  and a new one is created for the new time.
- A reminder is never sent after the meeting has started.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.models import Booking, MeetingReminder, Notification, User
from app.services.platform_settings import get_reminder_config

logger = logging.getLogger(__name__)

BUSINESS_TZ = ZoneInfo(settings.BUSINESS_TIMEZONE)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def booking_start_utc(start_time: str) -> Optional[datetime]:
    """
    A stored booking start as naive UTC.

    Booking times are wall clock in BUSINESS_TIMEZONE with a cosmetic trailing "Z" (see
    api/availability.py), so "2030-06-10T10:00:00Z" means 10:00 in that zone, not in UTC.
    """
    if not start_time:
        return None
    cleaned = start_time.replace("Z", "").replace("+00:00", "")
    try:
        wall = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    return wall.replace(tzinfo=BUSINESS_TZ).astimezone(timezone.utc).replace(tzinfo=None)


def ensure_reminder(db: Session, booking: Booking, config: Optional[dict] = None) -> Optional[MeetingReminder]:
    """
    The reminder row for this booking's current start time, created if there is none.

    Returns None when reminders are off, the booking is not confirmed, has no host, or has
    already started. Commits only when it creates a row.
    """
    config = config or get_reminder_config(db)
    if not config["enabled"] or booking.status != "confirmed" or not booking.admin_id:
        return None
    start_utc = booking_start_utc(booking.start_time)
    if start_utc is None or start_utc <= _utc_now():
        return None

    existing = (
        db.query(MeetingReminder)
        .filter(MeetingReminder.booking_id == booking.id, MeetingReminder.booking_start_time == booking.start_time)
        .first()
    )
    if existing:
        return existing

    lead = int(config["lead_minutes"])
    row = MeetingReminder(
        booking_id=booking.id,
        admin_id=booking.admin_id,
        booking_start_time=booking.start_time,
        lead_minutes=lead,
        remind_at=start_utc - timedelta(minutes=lead),
        status="pending",
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        # Another worker created it between our read and write: same outcome.
        db.rollback()
        return (
            db.query(MeetingReminder)
            .filter(MeetingReminder.booking_id == booking.id, MeetingReminder.booking_start_time == booking.start_time)
            .first()
        )
    return row


def _schedule_missing(db: Session, config: dict) -> int:
    """Creates rows for upcoming confirmed bookings that have none for their current time."""
    if not config["enabled"]:
        return 0
    # start_time is an ISO string, so a lexicographic floor on the date narrows the scan; the
    # exact "has it started" test happens in ensure_reminder.
    floor = (datetime.now(BUSINESS_TZ) - timedelta(days=1)).strftime("%Y-%m-%d")
    bookings = (
        db.query(Booking)
        .filter(Booking.status == "confirmed", Booking.admin_id.isnot(None), Booking.start_time >= floor)
        .all()
    )
    created = 0
    for booking in bookings:
        has_row = (
            db.query(MeetingReminder.id)
            .filter(MeetingReminder.booking_id == booking.id, MeetingReminder.booking_start_time == booking.start_time)
            .first()
        )
        if not has_row and ensure_reminder(db, booking, config):
            created += 1
    return created


def _finish(db: Session, reminder_id: str, status: str, detail: str, email_sent: bool = False) -> None:
    db.query(MeetingReminder).filter(MeetingReminder.id == reminder_id).update(
        {
            MeetingReminder.status: status,
            MeetingReminder.detail: detail[:255],
            MeetingReminder.email_sent: email_sent,
            MeetingReminder.sent_at: _utc_now() if status == "sent" else None,
        },
        synchronize_session=False,
    )
    db.commit()


def _format_when(start_time: str) -> str:
    cleaned = start_time.replace("Z", "").replace("+00:00", "")
    try:
        moment = datetime.fromisoformat(cleaned)
    except ValueError:
        return start_time
    return moment.strftime("%a %d %b %Y, %I:%M %p").replace(" 0", " ") + f" ({settings.BUSINESS_TIMEZONE})"


async def _deliver(db: Session, reminder: MeetingReminder, booking: Booking, host: User) -> tuple:
    """Sends through every channel. Returns (email_sent, detail)."""
    session_title = booking.meeting_type.title if booking.meeting_type else "Meeting"
    when = _format_when(booking.start_time)
    link_text = booking.google_meet_link or "No Google Meet link was created for this booking."

    # In-app: the notifications table the dashboard bell reads.
    db.add(Notification(
        admin_id=host.id,
        type="meeting_reminder",
        title=f"Upcoming meeting with {booking.client_name}",
        message=f"{session_title} · {when} · {link_text}",
        booking_id=booking.id,
    ))
    db.commit()

    # Email, through the existing Resend service. A failure is recorded, not retried: the
    # in-app reminder already went out, and a late duplicate is worse than none.
    email_sent = False
    try:
        from app.services.email_service import send_meeting_reminder_email

        email_sent = await send_meeting_reminder_email(
            admin_email=host.email,
            admin_name=host.name,
            client_name=booking.client_name,
            session_title=session_title,
            start_time=booking.start_time,
            meet_link=booking.google_meet_link,
        )
    except Exception as exc:  # noqa: BLE001 -- a provider fault must not break the run
        logger.warning("Reminder email for booking %s failed: %s", booking.id, exc)
    return email_sent, "in_app" + ("+email" if email_sent else "")


async def run_due_reminders(db: Session, now: Optional[datetime] = None) -> dict:
    """Schedules missing reminders and sends the due ones. Safe to call concurrently."""
    now = now or _utc_now()
    config = get_reminder_config(db)
    summary = {"scheduled": _schedule_missing(db, config), "sent": 0, "skipped": 0}

    if not config["enabled"]:
        return summary

    due = (
        db.query(MeetingReminder)
        .filter(MeetingReminder.status == "pending", MeetingReminder.remind_at <= now)
        .order_by(MeetingReminder.remind_at.asc())
        .limit(200)
        .all()
    )
    for reminder in due:
        booking = db.query(Booking).filter(Booking.id == reminder.booking_id).first()
        host = db.query(User).filter(User.id == reminder.admin_id).first()
        start_utc = booking_start_utc(reminder.booking_start_time)

        reason = None
        if booking is None:
            reason = "booking_deleted"
        elif booking.status != "confirmed":
            reason = f"booking_{booking.status}"
        elif booking.start_time != reminder.booking_start_time:
            reason = "rescheduled"
        elif booking.admin_id != reminder.admin_id or host is None or host.status != "ACTIVE":
            reason = "host_unavailable"
        elif start_utc is None or start_utc <= now:
            reason = "meeting_started"

        # Claim before doing anything visible. Only one caller can move pending -> sending.
        claimed = (
            db.query(MeetingReminder)
            .filter(MeetingReminder.id == reminder.id, MeetingReminder.status == "pending")
            .update({MeetingReminder.status: "sending"}, synchronize_session=False)
        )
        db.commit()
        if claimed != 1:
            continue

        if reason:
            _finish(db, reminder.id, "skipped", reason)
            summary["skipped"] += 1
            continue

        try:
            email_sent, detail = await _deliver(db, reminder, booking, host)
            _finish(db, reminder.id, "sent", detail, email_sent)
            summary["sent"] += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            logger.exception("Reminder %s could not be delivered", reminder.id)
            # "failed", not back to "pending": never risk a second delivery.
            _finish(db, reminder.id, "failed", str(exc) or exc.__class__.__name__)
    return summary


def run_once() -> dict:
    db = SessionLocal()
    try:
        return asyncio.run(run_due_reminders(db))
    finally:
        db.close()


async def reminder_worker(stop: asyncio.Event) -> None:
    """The in-process loop. Each run uses a fresh session in a worker thread."""
    interval = max(15, settings.REMINDER_POLL_SECONDS)
    logger.info("Meeting reminder worker started (every %ss).", interval)
    while not stop.is_set():
        try:
            summary = await asyncio.to_thread(run_once)
            if summary["sent"] or summary["skipped"] or summary["scheduled"]:
                logger.info("Meeting reminders: %s", summary)
        except Exception:  # noqa: BLE001 -- the loop must survive a bad run
            logger.exception("Meeting reminder run failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass
