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
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat() if n.created_at else None
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
