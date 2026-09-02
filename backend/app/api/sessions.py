from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.models import User, Session as SessionModel
from app.schemas.schemas import SessionCreate, SessionUpdate, SessionResponse
from app.api.deps import get_current_admin

router = APIRouter()

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
