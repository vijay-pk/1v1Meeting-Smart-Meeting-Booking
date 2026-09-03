import logging

from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.models.models import (
    User, AdminProfile, Session as SessionModel, AvailabilityRule,
    AvailabilityException, GoogleConnection, Booking, SlotLock
)
from app.schemas.schemas import (
    AvailabilitySaveRequest,
    AvailabilityRuleItem,
    AvailabilityExceptionItem,
    AvailabilityExceptionCreate,
)
from app.api.deps import get_current_admin
from app.services.google_calendar import get_google_busy_intervals, GoogleCalendarUnavailable

logger = logging.getLogger(__name__)

router = APIRouter()

# Working hours, bookings and slot locks are all stored as bare wall clock in this zone
# (the trailing "Z" on stored ISO strings is cosmetic). Google, by contrast, speaks real
# UTC -- BUSINESS_TZ is what bridges the two frames.
BUSINESS_TZ = ZoneInfo(settings.BUSINESS_TIMEZONE)


def _normalize_time(value):
    """
    Canonical wall-clock form: "HH:MM", or None.

    The frontend has sent "09:00" and "09:00:00" at different times, and the slot engine
    parses "%H:%M" -- so everything is stored in one shape rather than trusting the caller.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.strptime(text[:5], "%H:%M").strftime("%H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid time '{value}'. Use HH:MM.")


@router.get("/rules", response_model=List[AvailabilityRuleItem])
def get_my_availability_rules(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    rules = (
        db.query(AvailabilityRule)
        .filter(AvailabilityRule.admin_id == current_admin.id)
        .order_by(AvailabilityRule.day_of_week.asc())
        .all()
    )
    return [
        AvailabilityRuleItem(
            day_of_week=r.day_of_week,
            start_time=r.start_time,
            end_time=r.end_time,
            is_active=r.is_active
        )
        for r in rules
    ]

@router.post("/rules")
def save_my_availability_rules(
    req: AvailabilitySaveRequest,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    # Validate the whole payload first. The write below replaces the admin's rules, so a
    # range rejected halfway through must not leave them with fewer hours than they had.
    validated = []
    for item in req.rules:
        start = _normalize_time(item.start_time)
        end = _normalize_time(item.end_time)
        if not start or not end:
            raise HTTPException(status_code=400, detail="Each range needs a start and an end time.")
        if start >= end:
            raise HTTPException(
                status_code=400,
                detail=f"End time must be after start time ({start}-{end}).",
            )
        if not 0 <= item.day_of_week <= 6:
            raise HTTPException(status_code=400, detail="day_of_week must be 0 (Sunday) to 6.")
        validated.append((item.day_of_week, start, end, item.is_active))

    db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == current_admin.id).delete()

    for day_of_week, start, end, is_active in validated:
        db.add(AvailabilityRule(
            admin_id=current_admin.id,
            day_of_week=day_of_week,
            start_time=start,
            end_time=end,
            is_active=is_active
        ))

    db.commit()
    return {"message": "Availability rules updated successfully"}

@router.get("/exceptions", response_model=List[AvailabilityExceptionItem])
def get_my_availability_exceptions(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Blocked dates for the signed-in admin, soonest first."""
    rows = (
        db.query(AvailabilityException)
        .filter(AvailabilityException.admin_id == current_admin.id)
        .order_by(AvailabilityException.exception_date.asc())
        .all()
    )
    return [
        AvailabilityExceptionItem(
            id=row.id,
            exception_date=row.exception_date,
            is_available=row.is_available,
            start_time=row.start_time,
            end_time=row.end_time,
            reason=row.reason,
        )
        for row in rows
    ]


@router.post("/exceptions", response_model=AvailabilityExceptionItem)
def add_my_availability_exception(
    req: AvailabilityExceptionCreate,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    Blocks a date, or a window inside it, for the signed-in admin.

    The owner is always the authenticated user -- never a value supplied by the client --
    so one admin can never write a blocked date onto another's calendar.
    """
    try:
        datetime.strptime(req.exception_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be in YYYY-MM-DD format.")

    start = _normalize_time(req.start_time)
    end = _normalize_time(req.end_time)
    if (start is None) != (end is None):
        raise HTTPException(
            status_code=400,
            detail="Give both a start and an end time, or neither to block the whole day.",
        )
    if start and end and start >= end:
        raise HTTPException(status_code=400, detail="End time must be after start time.")

    row = AvailabilityException(
        admin_id=current_admin.id,
        exception_date=req.exception_date,
        is_available=req.is_available,
        start_time=start,
        end_time=end,
        reason=(req.reason or None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return AvailabilityExceptionItem(
        id=row.id,
        exception_date=row.exception_date,
        is_available=row.is_available,
        start_time=row.start_time,
        end_time=row.end_time,
        reason=row.reason,
    )


@router.delete("/exceptions/{exception_id}")
def delete_my_availability_exception(
    exception_id: str,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    row = (
        db.query(AvailabilityException)
        .filter(
            AvailabilityException.id == exception_id,
            # Ownership re-checked here, never taken from the request.
            AvailabilityException.admin_id == current_admin.id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Blocked date not found")

    db.delete(row)
    db.commit()
    return {"deleted": exception_id}


@router.get("/slots")
async def get_available_slots(
    admin_id: Optional[str] = None,
    username: Optional[str] = None,
    session_id: str = Query(...),
    date_str: str = Query(..., pattern="^[0-9]{4}-[0-9]{2}-[0-9]{2}$"),  # YYYY-MM-DD
    client_timezone: str = Query("Asia/Kolkata"),
    db: Session = Depends(get_db)
):
    """
    Calculates final available slots using the exact formula:
    FINAL AVAILABLE SLOTS = Working Hours - Google Calendar Busy - Leave/Holidays - Confirmed Bookings - Buffer Time
    """
    # 1. Resolve Admin
    user = None
    if admin_id:
        user = db.query(User).filter(User.id == admin_id).first()
    elif username:
        profile = db.query(AdminProfile).filter(AdminProfile.username == username.lower()).first()
        if profile:
            user = profile.user

    if not user:
        raise HTTPException(status_code=404, detail="Admin not found")

    if user.status != "ACTIVE":
        return {"available_slots": [], "message": "Admin is currently not taking bookings."}

    # 2. Fetch Session details
    session_obj = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session_obj or not session_obj.is_active:
        raise HTTPException(status_code=404, detail="Session not found or inactive")

    target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    # Python weekday(): 0=Mon, 6=Sun. We map to: 0=Sun, 1=Mon... 6=Sat
    day_of_week = (target_date.weekday() + 1) % 7

    # 3. Check for Date Exception (Leave / Holiday)
    exceptions_today = (
        db.query(AvailabilityException)
        .filter(
            AvailabilityException.admin_id == user.id,
            AvailabilityException.exception_date == date_str
        )
        .all()
    )
    # A block with no times covers the whole day; one with times removes only that window
    # (a 12:00-13:00 lunch inside 09:00-17:00), handled further down in is_colliding.
    blocked_windows = []
    for row in exceptions_today:
        if row.is_available:
            continue
        if not row.start_time or not row.end_time:
            return {
                "available_slots": [],
                "date": date_str,
                "admin_id": user.id,
                "message": "Admin is on leave on this date."
            }
        try:
            blocked_windows.append((
                datetime.combine(target_date, datetime.strptime(row.start_time[:5], "%H:%M").time()),
                datetime.combine(target_date, datetime.strptime(row.end_time[:5], "%H:%M").time()),
            ))
        except ValueError:
            continue

    # 4. Working hours for this day -- ALL of them.
    #    This used to take `.first()`, so an admin with 09:00-13:00 and 14:00-17:00 on the
    #    same day only ever got slots from the morning window. There is deliberately no
    #    default: hours the admin never configured must not be offered to clients.
    rules = (
        db.query(AvailabilityRule)
        .filter(
            AvailabilityRule.admin_id == user.id,
            AvailabilityRule.day_of_week == day_of_week,
            AvailabilityRule.is_active == True
        )
        .order_by(AvailabilityRule.start_time.asc())
        .all()
    )
    if not rules:
        return {
            "available_slots": [],
            "date": date_str,
            "admin_id": user.id,
            "message": "No working hours configured for this day."
        }

    working_windows = []
    for rule in rules:
        try:
            # Times are stored as wall clock; tolerate both HH:MM and HH:MM:SS.
            window_start = datetime.combine(
                target_date, datetime.strptime(rule.start_time[:5], "%H:%M").time()
            )
            window_end = datetime.combine(
                target_date, datetime.strptime(rule.end_time[:5], "%H:%M").time()
            )
        except ValueError:
            continue
        if window_end > window_start:
            working_windows.append((window_start, window_end))

    if not working_windows:
        return {
            "available_slots": [],
            "date": date_str,
            "admin_id": user.id,
            "message": "No working hours configured for this day."
        }

    duration = timedelta(minutes=session_obj.duration_minutes)
    buffer_before = timedelta(minutes=session_obj.buffer_before_minutes)
    buffer_after = timedelta(minutes=session_obj.buffer_after_minutes)
    step = timedelta(minutes=15)  # 15-minute slot increments

    # 5. Fetch Confirmed Bookings on this date
    day_start_iso = f"{date_str}T00:00:00Z"
    day_end_iso = f"{date_str}T23:59:59Z"

    existing_bookings = (
        db.query(Booking)
        .filter(
            Booking.admin_id == user.id,
            Booking.status.in_(["confirmed", "pending_payment"]),
            Booking.start_time >= day_start_iso,
            Booking.start_time <= day_end_iso
        )
        .all()
    )

    # 6. Fetch Active Slot Locks
    now_utc = datetime.now(timezone.utc)
    active_locks = (
        db.query(SlotLock)
        .filter(
            SlotLock.admin_id == user.id,
            SlotLock.status == "active",
            SlotLock.expires_at > now_utc
        )
        .all()
    )

    # 7. Fetch Google Calendar Busy Intervals.
    # The window sent to Google must be real UTC: the admin's local day, converted.
    google_busy = []
    g_conn = (
        db.query(GoogleConnection)
        .filter(
            GoogleConnection.admin_id == user.id,
            GoogleConnection.connection_status == "connected"
        )
        .first()
    )
    if g_conn and g_conn.encrypted_refresh_token:
        window_start_utc = (
            datetime.combine(target_date, datetime.min.time(), tzinfo=BUSINESS_TZ)
            .astimezone(timezone.utc)
        )
        window_end_utc = window_start_utc + timedelta(days=1)
        try:
            google_busy_raw = await get_google_busy_intervals(
                g_conn.encrypted_refresh_token,
                window_start_utc.isoformat().replace("+00:00", "Z"),
                window_end_utc.isoformat().replace("+00:00", "Z"),
                g_conn.calendar_id or "primary"
            )
        except GoogleCalendarUnavailable as exc:
            logger.warning("Google Calendar unavailable for admin %s: %s", user.id, exc)
            return {
                "available_slots": [],
                "date": date_str,
                "admin_id": user.id,
                "calendar_error": True,
                "message": "Calendar sync unavailable — booking is temporarily paused for this host."
            }

        # Convert each busy interval from real UTC into business-timezone wall clock, so it
        # can be compared with the naive wall-clock slots generated below.
        for gb in google_busy_raw:
            try:
                gb_start = datetime.fromisoformat(gb["start"].replace("Z", "+00:00"))
                gb_end = datetime.fromisoformat(gb["end"].replace("Z", "+00:00"))
                google_busy.append({
                    "start": gb_start.astimezone(BUSINESS_TZ).replace(tzinfo=None),
                    "end": gb_end.astimezone(BUSINESS_TZ).replace(tzinfo=None),
                })
            except Exception:
                # An unparseable interval must not silently vanish into "free".
                return {
                    "available_slots": [],
                    "date": date_str,
                    "admin_id": user.id,
                    "calendar_error": True,
                    "message": "Calendar sync unavailable — booking is temporarily paused for this host."
                }

    # Helper function to check collision
    def is_colliding(slot_start: datetime, slot_end: datetime) -> bool:
        buffered_start = slot_start - buffer_before
        buffered_end = slot_end + buffer_after

        # Check existing bookings
        for b in existing_bookings:
            try:
                b_start = datetime.fromisoformat(b.start_time.replace("Z", "+00:00")).replace(tzinfo=None)
                b_end = datetime.fromisoformat(b.end_time.replace("Z", "+00:00")).replace(tzinfo=None)
                if not (buffered_end <= b_start or buffered_start >= b_end):
                    return True
            except Exception:
                continue

        # Check slot locks
        for lock in active_locks:
            try:
                l_start = datetime.fromisoformat(lock.start_time.replace("Z", "+00:00")).replace(tzinfo=None)
                l_end = datetime.fromisoformat(lock.end_time.replace("Z", "+00:00")).replace(tzinfo=None)
                if not (buffered_end <= l_start or buffered_start >= l_end):
                    return True
            except Exception:
                continue

        # Check admin-declared blocked windows (partial-day exceptions)
        for block_start, block_end in blocked_windows:
            if not (buffered_end <= block_start or buffered_start >= block_end):
                return True

        # Check Google Calendar Busy intervals (already normalised to business-tz wall clock)
        for gb in google_busy:
            if not (buffered_end <= gb["start"] or buffered_start >= gb["end"]):
                return True

        return False

    # 8. Generate non-colliding slots across every configured window for this day
    slots = []
    # "Now" in the admin's zone, as naive wall clock, to match the slot frame. Server local
    # time would be wrong on any host that isn't running in BUSINESS_TIMEZONE.
    now_business = datetime.now(BUSINESS_TZ).replace(tzinfo=None)
    min_notice = now_business + timedelta(hours=session_obj.min_advance_hours)

    for window_start, window_end in working_windows:
        current_slot = window_start
        while current_slot + duration <= window_end:
            slot_finish = current_slot + duration
            if current_slot.minute not in (0, 30):
                current_slot += step
                continue
            if current_slot >= min_notice and not is_colliding(current_slot, slot_finish):
                slots.append({
                    "start": current_slot.strftime("%H:%M"),
                    "end": slot_finish.strftime("%H:%M"),
                    "start_time_iso": f"{date_str}T{current_slot.strftime('%H:%M')}:00Z",
                    "end_time_iso": f"{date_str}T{slot_finish.strftime('%H:%M')}:00Z",
                    "label": current_slot.strftime("%I:%M %p").lstrip("0")
                })
            current_slot += step

    # Overlapping windows could otherwise offer the same start twice.
    slots = list({slot["start"]: slot for slot in slots}.values())
    slots.sort(key=lambda slot: slot["start"])

    return {"available_slots": slots, "date": date_str, "admin_id": user.id}
