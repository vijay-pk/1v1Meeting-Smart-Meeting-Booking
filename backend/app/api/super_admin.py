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
from app.services import admin_deletion

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
        raise HTTPException(status_code=403, detail="You cannot change your own account status")

    if admin.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Only admin accounts can be managed through this endpoint."
        )

    # PERMANENTLY_DELETED is deliberately not settable here. A status flag is a
    # suspension, not a deletion -- real removal goes through DELETE /admins/{id}, which
    # erases the data and blocks the email from registering again.
    valid_statuses = ["ACTIVE", "TEMPORARILY_DISABLED"]
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
    reason: Optional[str] = Query(None, max_length=255, description="Optional audit note"),
    current_super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db)
):
    """
    Permanently removes an admin account and every piece of admin-owned data.

    Authorization is entirely server-side: `get_current_super_admin` re-reads the role
    from the database on each request, so a role claimed by the client is never trusted.
    Only role == "admin" accounts can be targeted -- neither the caller nor any other
    super admin can be removed through this endpoint.

    See services/admin_deletion.py for exactly what is deleted, what is anonymized and
    what tombstone survives. The email of a deleted admin can never register again.
    """
    if not confirm:
        raise HTTPException(status_code=400, detail="Deletion confirmation is required")

    admin = db.query(User).filter(User.id == admin_id).first()
    if not admin:
        # Idempotent: an already-deleted admin is simply gone.
        raise HTTPException(status_code=404, detail="Admin not found")

    if admin.id == current_super_admin.id:
        raise HTTPException(status_code=403, detail="You cannot delete your own account")

    if admin.role != "admin":
        # Covers super admins and client accounts. Deliberately not "not found": the
        # caller is a super admin and is entitled to know the target is out of scope.
        raise HTTPException(
            status_code=403,
            detail="Only admin accounts can be deleted through this endpoint."
        )

    admin_name = admin.name

    try:
        summary = admin_deletion.permanently_delete_admin(
            db,
            admin,
            deleted_by=current_super_admin.id,
            reason=reason,
        )
    except admin_deletion.AdminDeletionError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "message": f"Admin '{admin_name}' permanently deleted",
        "admin_id": admin_id,
        "deleted": summary,
    }

@router.get("/bookings")
def get_all_platform_bookings(
    current_super_admin: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db)
):
    bookings = db.query(Booking).order_by(Booking.created_at.desc()).limit(100).all()
    results = []
    for b in bookings:
        admin = b.admin
        payment = b.payment
        results.append({
            "id": b.id,
            "public_id": b.public_id,
            "admin_id": b.admin_id,
            # admin_id is NULL only after a permanent deletion (see admin_deletion.py).
            "admin_name": admin.name if admin else "Removed admin",
            "admin_email": admin.email if admin else None,
            # What this booking actually took, and into whose account. Reported only when
            # the payment was really captured: a simulated or pending row has no money
            # behind it and must not be shown as revenue.
            "amount": payment.amount if payment and payment.status == "captured" else None,
            "currency": payment.currency if payment else "INR",
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
    # Only "captured" counts. A simulated payment is stored as status "simulated"
    # precisely so it can never be added to real money.
    total_revenue = (
        db.query(func.sum(Payment.amount))
        .filter(Payment.status == "captured")
        .scalar() or 0
    )

    # Per-consultant breakdown, so the console shows whose bookings and whose revenue
    # these are. Read-only aggregation over the existing ownership columns
    # (bookings.admin_id, payments.admin_id) -- it creates no records and moves no money.
    booking_counts = dict(
        db.query(Booking.admin_id, func.count(Booking.id))
        .group_by(Booking.admin_id)
        .all()
    )
    revenue_by_admin = dict(
        db.query(Payment.admin_id, func.sum(Payment.amount))
        .filter(Payment.status == "captured")
        .group_by(Payment.admin_id)
        .all()
    )

    by_admin = []
    for admin in db.query(User).filter(User.role.in_(["admin", "super_admin"])).all():
        bookings_for_admin = int(booking_counts.get(admin.id) or 0)
        revenue_for_admin = int(revenue_by_admin.get(admin.id) or 0)
        if bookings_for_admin == 0 and revenue_for_admin == 0:
            continue
        by_admin.append({
            "admin_id": admin.id,
            "admin_name": admin.name,
            # The Super Admin may also sell sessions from their own page; that row is
            # genuinely theirs, and the console labels it so rather than as a consultant.
            "role": admin.role,
            "bookings": bookings_for_admin,
            "revenue": revenue_for_admin,
        })

    # Rows whose admin was permanently deleted keep their money but lose their owner
    # (admin_id is set NULL). Reporting them as an unattributed line keeps the
    # breakdown adding up to the platform total instead of silently losing it.
    orphan_bookings = int(booking_counts.get(None) or 0)
    orphan_revenue = int(revenue_by_admin.get(None) or 0)
    if orphan_bookings or orphan_revenue:
        by_admin.append({
            "admin_id": None,
            "admin_name": "Removed admins",
            "role": None,
            "bookings": orphan_bookings,
            "revenue": orphan_revenue,
        })

    by_admin.sort(key=lambda row: row["revenue"], reverse=True)

    return {
        "total_admins": total_admins,
        "active_admins": active_admins,
        "disabled_admins": disabled_admins,
        "total_bookings": total_bookings,
        "confirmed_bookings": confirmed_bookings,
        "total_revenue": total_revenue,
        "by_admin": by_admin
    }
