"""
Explains WHY a student meeting type has no bookable time, from the saved configuration alone.

A type's own hours never create availability by themselves: the slot engine intersects them
with the host's general working hours (Settings -> Availability). When the general hours are
missing, or do not overlap the type's hours, every date comes back empty and -- before this --
the page said only "No times available", leaving nobody able to tell which setting to fix.

diagnose() looks at saved settings only (no calendar call, no bookings), so it names the
configuration problem when there is one and returns None when the setup is sound and the
calendar is simply full. Each result carries a student-facing sentence and a Super-Admin
sentence that says exactly what to change.
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import AvailabilityRule, Session as SessionModel

DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
_ORDER = [1, 2, 3, 4, 5, 6, 0]  # Monday first, as the Availability page reads

Range = tuple[int, int]  # minutes from midnight, start < end


def _minutes(hhmm: str) -> int:
    h, m = str(hhmm).strip()[:5].split(":")
    return int(h) * 60 + int(m)


def _fmt(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _ranges_text(ranges: list[Range]) -> str:
    return ", ".join(f"{_fmt(s)}-{_fmt(e)}" for s, e in sorted(ranges))


def summarize(by_day: dict[int, list[Range]]) -> str:
    """'every day 10:00-23:00' or 'Mon 09:00-17:00; Tue 09:00-17:00'."""
    if not by_day:
        return "no days"
    if len(by_day) == 7 and len({tuple(sorted(v)) for v in by_day.values()}) == 1:
        return f"every day {_ranges_text(next(iter(by_day.values())))}"
    return "; ".join(f"{DAY_NAMES[d]} {_ranges_text(by_day[d])}" for d in _ORDER if d in by_day)


def general_hours(db: Session, admin_id: str) -> dict[int, list[Range]]:
    """The host's saved, active working hours by weekday (0 = Sunday)."""
    out: dict[int, list[Range]] = {}
    for r in db.query(AvailabilityRule).filter(
        AvailabilityRule.admin_id == admin_id, AvailabilityRule.is_active == True  # noqa: E712
    ).all():
        try:
            s, e = _minutes(r.start_time), _minutes(r.end_time)
        except (ValueError, AttributeError):
            continue
        if e > s:
            out.setdefault(r.day_of_week, []).append((s, e))
    return out


def type_hours(session_obj: SessionModel) -> dict[int, list[Range]]:
    """The type's own saved windows by weekday; empty means it uses the general hours."""
    out: dict[int, list[Range]] = {}
    for w in session_obj.time_windows or []:
        try:
            s, e = _minutes(w.start_time), _minutes(w.end_time)
        except (ValueError, AttributeError):
            continue
        if e > s:
            out.setdefault(w.day_of_week, []).append((s, e))
    return out


def _issue(code: str, student: str, admin: str) -> dict:
    return {"code": code, "message": student, "admin_message": admin}


def diagnose(db: Session, host_id: str, session_obj: SessionModel) -> Optional[dict]:
    """The specific configuration problem blocking this type, or None if the setup is sound."""
    title = session_obj.title
    general = general_hours(db, host_id)

    if not general:
        return _issue(
            "no_working_hours",
            "The host has not set any working hours yet, so there is nothing to book. "
            "Please check back later or contact the Super Admin.",
            f"You have no working hours saved, so '{title}' cannot offer any time. A type's own "
            "hours only narrow your working hours; they never add to them. Open Settings > "
            "Availability and add the days and times you work.",
        )

    own = type_hours(session_obj)
    usable = {d: list(r) for d, r in (own or general).items()}
    duration = session_obj.duration_minutes or 0

    # Longest stretch where the type's hours and the working hours both apply.
    longest = 0
    for day, windows in usable.items():
        for ws, we in windows:
            for gs, ge in general.get(day, []):
                longest = max(longest, min(we, ge) - max(ws, gs))

    if own and longest <= 0:
        return _issue(
            "hours_do_not_overlap",
            "This session is not open for booking right now because of a scheduling setup "
            "issue. Please contact the Super Admin.",
            f"'{title}' is offered {summarize(own)}, but your working hours are "
            f"{summarize(general)}. They never overlap, so no time can be booked. Change the "
            "meeting type's hours, or your working hours in Settings > Availability.",
        )

    if longest < duration:
        return _issue(
            "duration_too_long",
            "This session is not open for booking right now because of a scheduling setup "
            "issue. Please contact the Super Admin.",
            f"'{title}' lasts {duration} minutes, but the longest stretch where its hours and "
            f"your working hours both apply is {max(longest, 0)} minutes. Lengthen the hours "
            "or shorten the session.",
        )

    return None
