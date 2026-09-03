import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.models import User, Session as SessionModel, Booking, SlotLock
from app.schemas.schemas import SlotLockRequest, SlotLockResponse, BookingResponse
from app.api.deps import get_current_admin

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

    # 2. Check if already confirmed booking exists
    existing_booking = (
        db.query(Booking)
        .filter(
            Booking.admin_id == req.admin_id,
            Booking.start_time == req.start_time,
            Booking.status.in_(["confirmed", "pending_payment"])
        )
        .first()
    )
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
def release_hold(lock_id: str, db: Session = Depends(get_db)):
    lock = db.query(SlotLock).filter(SlotLock.id == lock_id).first()
    if lock:
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
            "created_at": b.created_at.isoformat() if b.created_at else None
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

    # Free any active hold on this slot so the time is immediately bookable again.
    db.query(SlotLock).filter(
        SlotLock.admin_id == current_admin.id,
        SlotLock.start_time == booking.start_time,
        SlotLock.status == "active",
    ).update({SlotLock.status: "released"}, synchronize_session=False)

    db.commit()
    return {"id": booking.id, "status": booking.status}


@router.get("/public/{public_id}")
def get_public_booking(public_id: str, db: Session = Depends(get_db)):
    booking = db.query(Booking).filter(Booking.public_id == public_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    admin = booking.admin
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
        "google_meet_link": booking.google_meet_link
    }
