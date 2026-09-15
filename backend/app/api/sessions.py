from datetime import datetime
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


def _validated_windows(items: Optional[List[SessionTimeWindowItem]]) -> List[tuple]:
    """
    Checks a session's own hours before anything is written. One window per weekday, end after
    start. An empty list means "use my general availability".
    """
    if not items:
        return []
    seen = set()
    windows = []
    for item in items:
        if not 0 <= item.day_of_week <= 6:
            raise HTTPException(status_code=400, detail="day_of_week must be 0 (Sunday) to 6.")
        if item.day_of_week in seen:
            raise HTTPException(status_code=400, detail="Set at most one time range per day.")
        seen.add(item.day_of_week)
        start, end = _clean_time(item.start_time), _clean_time(item.end_time)
        if start >= end:
            raise HTTPException(
                status_code=400,
                detail=f"End time must be after start time ({start}-{end}).",
            )
        windows.append((item.day_of_week, start, end))
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

@router.post("/", response_model=SessionResponse)
def create_session(
    session_in: SessionCreate,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    windows = _validated_windows(session_in.available_hours)
    new_session = SessionModel(
        admin_id=current_admin.id,
        title=session_in.title,
        description=session_in.description,
        duration_minutes=session_in.duration_minutes,
        price=session_in.price,
        original_price=session_in.original_price,
        currency=session_in.currency,
        is_active=session_in.is_active,
        buffer_before_minutes=session_in.buffer_before_minutes,
        buffer_after_minutes=session_in.buffer_after_minutes,
        min_advance_hours=session_in.min_advance_hours,
        max_advance_days=session_in.max_advance_days
    )
    _replace_windows(new_session, windows)
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
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
    # Only touched when the caller sent it, so toggling is_active leaves the hours alone.
    hours_sent = "available_hours" in update_data
    update_data.pop("available_hours", None)
    if hours_sent:
        _replace_windows(session_obj, _validated_windows(session_in.available_hours))

    for field, value in update_data.items():
        setattr(session_obj, field, value)

    db.commit()
    db.refresh(session_obj)
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
    return {"message": "Session deleted successfully"}
