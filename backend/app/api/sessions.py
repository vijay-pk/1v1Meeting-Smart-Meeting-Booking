from datetime import datetime
from app.services import availability_cache
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.models import User, Session as SessionModel, SessionTimeWindow
from app.schemas.schemas import SessionCreate, SessionUpdate, SessionResponse, SessionTimeWindowItem
from app.api.deps import get_current_admin

router = APIRouter()


def _clean_time(value: str) -> str:
    try:
        return datetime.strptime(str(value).strip()[:5], "%H:%M").strftime("%H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid time '{value}'. Use HH:MM.")


# Mirrored in frontend/src/components/admin/SessionHoursField.tsx.
MAX_WINDOWS_PER_DAY = 10

DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

VALID_AUDIENCES = {"public", "student_free", "student_paid"}
STUDENT_AUDIENCES = {"student_free", "student_paid"}


def _validate_audience(value):
    if value is not None and value not in VALID_AUDIENCES:
        raise HTTPException(status_code=400, detail="audience must be public, student_free or student_paid.")
    return value


def _enforce_student_type_permission(current_admin: User, *audiences) -> None:
    """
    Only the Super Admin may create or modify a student meeting type. Students book the Super
    Admin as their host, so student types belong to that account; a regular admin's meeting
    types and schedule must never depend on them.
    """
    if any(a in STUDENT_AUDIENCES for a in audiences) and current_admin.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only the Super Admin manages student meeting types.")


def _validated_windows(items: Optional[List[SessionTimeWindowItem]]) -> List[tuple]:
    """
    Checks a session's own hours before anything is written. A weekday may have several
    windows (10:00-12:00 and 16:00-17:00); each must end after it starts, and windows on the
    same day may touch but never repeat or overlap. They are kept as separate rows, never
    merged. An empty list means "use my general availability".

    Returned sorted by (day, start), which is the order they are stored and shown in.
    """
    if not items:
        return []
    windows = []
    for item in items:
        if not 0 <= item.day_of_week <= 6:
            raise HTTPException(status_code=400, detail="day_of_week must be 0 (Sunday) to 6.")
        start, end = _clean_time(item.start_time), _clean_time(item.end_time)
        if start >= end:
            raise HTTPException(
                status_code=400,
                detail=f"End time must be after start time ({start}-{end}).",
            )
        windows.append((item.day_of_week, start, end))

    windows.sort()
    per_day: dict = {}
    for day, start, end in windows:
        per_day.setdefault(day, []).append((start, end))
    for day, ranges in per_day.items():
        if len(ranges) > MAX_WINDOWS_PER_DAY:
            raise HTTPException(
                status_code=400,
                detail=f"{DAY_NAMES[day]}: at most {MAX_WINDOWS_PER_DAY} time windows per day.",
            )
        for (prev_start, prev_end), (start, end) in zip(ranges, ranges[1:]):
            if (prev_start, prev_end) == (start, end):
                raise HTTPException(
                    status_code=400,
                    detail=f"{DAY_NAMES[day]}: the time window {start}-{end} is listed twice.",
                )
            if start < prev_end:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{DAY_NAMES[day]}: time windows cannot overlap "
                        f"({prev_start}-{prev_end} and {start}-{end})."
                    ),
                )
    return windows


def _replace_windows(session_obj: SessionModel, windows: List[tuple]) -> None:
    session_obj.time_windows = [
        SessionTimeWindow(admin_id=session_obj.admin_id, day_of_week=d, start_time=s, end_time=e)
        for d, s, e in windows
    ]


@router.get("/", response_model=List[SessionResponse])
def get_my_sessions(current_admin: User = Depends(get_current_admin), db: Session = Depends(get_db)):
    sessions = (
        db.query(SessionModel)
        .filter(SessionModel.admin_id == current_admin.id)
        .order_by(SessionModel.sort_order.asc(), SessionModel.created_at.asc())
        .all()
    )
    return sessions

def _normalize_pricing(audience: str, price, original_price):
    """
    Real Price / Offer Price rules for REGULAR client meeting types. Stored in the existing columns:
    `price` is what the customer pays (the Offer Price when there is one) and `original_price` is the
    Real Price shown struck through. Student types never carry a Real Price.

      - no offer           -> price = what is charged, original_price NULL
      - offer (< real)     -> price = offer (> 0), original_price = real
      - offer == real      -> no discount: original_price NULL
      - negative anywhere, offer > real, or a zero/negative real price -> 400
    """
    price = 0 if price is None else price
    if price < 0 or (original_price is not None and original_price < 0):
        raise HTTPException(status_code=400, detail="Prices cannot be negative.")
    if audience in ("student_free", "student_paid"):
        return price, None
    if original_price is None:
        return price, None
    if original_price == 0:
        raise HTTPException(status_code=400, detail="Real price must be greater than zero when an offer is set.")
    if price == 0:
        raise HTTPException(status_code=400, detail="Offer price must be greater than zero.")
    if price > original_price:
        raise HTTPException(status_code=400, detail="Offer price cannot be higher than the real price.")
    if price == original_price:
        return price, None
    return price, original_price


@router.post("/", response_model=SessionResponse)
def create_session(
    session_in: SessionCreate,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    windows = _validated_windows(session_in.available_hours)
    audience = session_in.audience or "public"
    _validate_audience(audience)
    # Student meeting types are the Super Admin's to manage (students book the Super Admin as
    # their host). A regular admin must not create them, and a free student type is free on the
    # server regardless of any price the client sent -- the price field is removed from that
    # form, but the guarantee lives here, not in the UI.
    _enforce_student_type_permission(current_admin, audience)
    price, original_price = _normalize_pricing(
        audience, 0 if audience == "student_free" else session_in.price, session_in.original_price)
    new_session = SessionModel(
        admin_id=current_admin.id,
        title=session_in.title,
        description=session_in.description,
        duration_minutes=session_in.duration_minutes,
        price=price,
        original_price=original_price,
        currency=session_in.currency,
        is_active=session_in.is_active,
        buffer_before_minutes=session_in.buffer_before_minutes,
        buffer_after_minutes=session_in.buffer_after_minutes,
        min_advance_hours=session_in.min_advance_hours,
        max_advance_days=session_in.max_advance_days,
        audience=audience,
    )
    _replace_windows(new_session, windows)
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    availability_cache.invalidate_admin(current_admin.id)
    return new_session

@router.put("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    session_in: SessionUpdate,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    session_obj = (
        db.query(SessionModel)
        .filter(SessionModel.id == session_id, SessionModel.admin_id == current_admin.id)
        .first()
    )
    if not session_obj:
        raise HTTPException(status_code=404, detail="Session not found")

    update_data = session_in.dict(exclude_unset=True)
    if "audience" in update_data:
        _validate_audience(update_data["audience"])
    # Guard on both the current and the target audience, so a regular admin can neither edit an
    # existing student type nor switch a type into one. A free student type is forced to price 0
    # on the server, whatever the client sent.
    resulting_audience = update_data.get("audience", session_obj.audience)
    _enforce_student_type_permission(current_admin, session_obj.audience, resulting_audience)
    if resulting_audience == "student_free":
        update_data["price"] = 0
    # Pricing is re-validated only when the caller touches it (or moves the type between regular and
    # student), merged with the stored values, so toggling is_active can never alter a price.
    if any(k in update_data for k in ("price", "original_price", "audience")):
        new_price, new_original = _normalize_pricing(
            resulting_audience,
            update_data.get("price", session_obj.price),
            update_data["original_price"] if "original_price" in update_data else session_obj.original_price,
        )
        update_data["price"] = new_price
        update_data["original_price"] = new_original
    # Only touched when the caller sent it, so toggling is_active leaves the hours alone.
    hours_sent = "available_hours" in update_data
    update_data.pop("available_hours", None)
    if hours_sent:
        _replace_windows(session_obj, _validated_windows(session_in.available_hours))

    for field, value in update_data.items():
        setattr(session_obj, field, value)

    db.commit()
    db.refresh(session_obj)
    availability_cache.invalidate_admin(current_admin.id)
    return session_obj

@router.delete("/{session_id}")
def delete_session(
    session_id: str,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    session_obj = (
        db.query(SessionModel)
        .filter(SessionModel.id == session_id, SessionModel.admin_id == current_admin.id)
        .first()
    )
    if not session_obj:
        raise HTTPException(status_code=404, detail="Session not found")

    db.delete(session_obj)
    db.commit()
    availability_cache.invalidate_admin(current_admin.id)
    return {"message": "Session deleted successfully"}
