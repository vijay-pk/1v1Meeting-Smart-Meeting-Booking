from datetime import timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.models import User, Notification
from app.api.deps import get_current_admin

router = APIRouter()

@router.get("/")
def get_my_notifications(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    notifications = (
        db.query(Notification)
        .filter(Notification.admin_id == current_admin.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": n.id,
            "type": n.type,
            "title": n.title,
            "message": n.message,
            "booking_id": n.booking_id,
            "is_read": n.is_read,
            # Stored as naive UTC; say so, or a browser reads it as local time ("5h ago").
            "created_at": (
                (n.created_at if n.created_at.tzinfo else n.created_at.replace(tzinfo=timezone.utc)).isoformat()
                if n.created_at else None
            )
        }
        for n in notifications
    ]

@router.post("/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    n = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.admin_id == current_admin.id
    ).first()
    if n:
        n.is_read = True
        db.commit()
    return {"message": "Marked as read"}


@router.post("/read-all")
def mark_all_notifications_read(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    db.query(Notification).filter(
        Notification.admin_id == current_admin.id,
        Notification.is_read == False,  # noqa: E712
    ).update({Notification.is_read: True}, synchronize_session=False)
    db.commit()
    return {"message": "Marked all as read"}
