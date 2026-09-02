from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.database import get_db
from app.models.models import (
    User, AdminProfile, Booking, Payment, GoogleConnection, RazorpayConnection
)
from app.schemas.schemas import (
    SuperAdminAdminItem, AdminStatusUpdate, PlatformAnalytics
)
from app.api.deps import get_current_super_admin

router = APIRouter()

@router.get("/admins", response_model=List[SuperAdminAdminItem])
def list_admins(
    search: Optional[str] = None,
    status_filter: Optional[str] = None,
    current_super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db)
):
    """Lists all admins with connection statuses, bookings count, and financial metrics."""
    query = db.query(User).filter(User.role == "admin")

    if status_filter:
        query = query.filter(User.status == status_filter)

    if search:
        search_term = f"%{search.strip().lower()}%"
        query = (
            query.join(AdminProfile, isouter=True)
            .filter(
                (User.name.ilike(search_term)) |
                (User.email.ilike(search_term)) |
                (AdminProfile.username.ilike(search_term))
            )
        )

    users = query.order_by(User.created_at.desc()).all()
    results = []

    for u in users:
        profile = u.profile
        username = profile.username if profile else u.email.split("@")[0]

        # Google Connection Status
        g_conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == u.id).first()
        g_connected = bool(g_conn and g_conn.connection_status == "connected")
        g_email = g_conn.google_email if g_conn else None

        # Razorpay Connection Status
        r_conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == u.id).first()
        r_configured = bool(r_conn and r_conn.connection_status == "connected")
        r_key = r_conn.key_id if r_conn else None

        # Bookings & Revenue
        b_count = db.query(Booking).filter(Booking.admin_id == u.id).count()
        revenue_sum = (
            db.query(func.sum(Payment.amount))
            .filter(Payment.admin_id == u.id, Payment.status == "captured")
            .scalar() or 0
        )

        results.append(SuperAdminAdminItem(
            id=u.id,
            username=username,
            name=u.name,
            email=u.email,
            phone=u.phone,
            role=u.role,
            status=u.status,
            google_connected=g_connected,
            google_email=g_email,
            razorpay_configured=r_configured,
            razorpay_key_id=r_key,
            bookings_count=b_count,
            total_revenue=revenue_sum,
            created_at=u.created_at.isoformat() if u.created_at else None
        ))

    return results

@router.put("/admins/{admin_id}/status")
def update_admin_status(
    admin_id: str,
    req: AdminStatusUpdate,
    current_super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db)
):
    """Updates an admin's account status (ACTIVE or TEMPORARILY_DISABLED)."""
    admin = db.query(User).filter(User.id == admin_id).first()
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")

    if admin.id == current_super_admin.id:
        raise HTTPException(status_code=400, detail="Cannot change status of the Super Admin account")

    valid_statuses = ["ACTIVE", "TEMPORARILY_DISABLED", "PERMANENTLY_DELETED"]
    if req.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(valid_statuses)}")

    admin.status = req.status
    db.commit()

    return {
        "message": f"Admin status updated to {req.status}",
        "admin_id": admin.id,
        "status": admin.status
    }

@router.delete("/admins/{admin_id}")
def permanently_delete_admin(
    admin_id: str,
    confirm: bool = Query(..., description="Must explicitly confirm deletion"),
    current_super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db)
):
    """
    Permanently removes an admin account after explicit confirmation.
    Public profile and future access are immediately revoked.
    """
    if not confirm:
        raise HTTPException(status_code=400, detail="Deletion confirmation is required")

    admin = db.query(User).filter(User.id == admin_id).first()
    if not admin:
        raise HTTPException(status_code=404, detail="Admin not found")

    if admin.id == current_super_admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete the Super Admin account")

    # Mark as PERMANENTLY_DELETED and cascade cleanup
    admin_name = admin.name
    admin.status = "PERMANENTLY_DELETED"
    db.delete(admin)
    db.commit()

    return {"message": f"Admin '{admin_name}' permanently deleted successfully"}

@router.get("/bookings")
def get_all_platform_bookings(
    current_super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db)
):
    bookings = db.query(Booking).order_by(Booking.created_at.desc()).limit(100).all()
    results = []
    for b in bookings:
        admin = b.admin
        results.append({
            "id": b.id,
            "public_id": b.public_id,
            "admin_name": admin.name if admin else "Unknown",
            "admin_email": admin.email if admin else "Unknown",
            "client_name": b.client_name,
            "client_email": b.client_email,
            "session_title": b.meeting_type.title if b.meeting_type else "Session",
            "start_time": b.start_time,
            "end_time": b.end_time,
            "status": b.status,
            "payment_status": b.payment_status,
            "google_meet_link": b.google_meet_link,
            "created_at": b.created_at.isoformat() if b.created_at else None
        })
    return results

@router.get("/analytics", response_model=PlatformAnalytics)
def get_platform_analytics(
    current_super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db)
):
    total_admins = db.query(User).filter(User.role == "admin").count()
    active_admins = db.query(User).filter(User.role == "admin", User.status == "ACTIVE").count()
    disabled_admins = db.query(User).filter(User.role == "admin", User.status == "TEMPORARILY_DISABLED").count()

    total_bookings = db.query(Booking).count()
    confirmed_bookings = db.query(Booking).filter(Booking.status == "confirmed").count()
    total_revenue = (
        db.query(func.sum(Payment.amount))
        .filter(Payment.status == "captured")
        .scalar() or 0
    )

    return {
        "total_admins": total_admins,
        "active_admins": active_admins,
        "disabled_admins": disabled_admins,
        "total_bookings": total_bookings,
        "confirmed_bookings": confirmed_bookings,
        "total_revenue": total_revenue
    }
