"""
Student self-service change rules. The one rule here is the 24-hour deadline: a student may
cancel or reschedule their own meeting only up to 24 hours before its start. Computed from the
booking's timezone-aware start time and enforced on the backend, so an old email link or a
direct API call cannot bypass it.
"""
from datetime import timedelta

from app.services.reminders import booking_start_utc, _utc_now

CHANGE_WINDOW_HOURS = 24


def change_deadline_utc(start_time: str):
    """The last moment a student may self-change the booking: start - 24h (naive UTC)."""
    start = booking_start_utc(start_time)
    if start is None:
        return None
    return start - timedelta(hours=CHANGE_WINDOW_HOURS)


def within_change_window(start_time: str) -> bool:
    """True while the student may still cancel/reschedule themselves."""
    deadline = change_deadline_utc(start_time)
    if deadline is None:
        return False
    return _utc_now() < deadline


def change_info(booking, now=None) -> dict:
    """
    What a student may do with this booking RIGHT NOW, from the same stored facts the backend
    enforces: cutoff = scheduled start - 24h, and only while the booking is confirmed and has not
    started. The UI uses `can_change` and `change_deadline_at` (UTC, "Z") to show or hide Cancel
    and Reschedule; the endpoints re-check on every request regardless.
    """
    from app.services.meeting_termination import iso_utc
    now = now or _utc_now()
    deadline = change_deadline_utc(booking.start_time)
    start = booking_start_utc(booking.start_time)
    allowed = (
        booking.status == "confirmed"
        and deadline is not None
        and start is not None
        and now < deadline
        and now < start
    )
    return {"can_change": bool(allowed), "change_deadline_at": iso_utc(deadline)}
