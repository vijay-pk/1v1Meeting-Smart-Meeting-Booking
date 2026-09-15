"""
Platform-wide settings owned by the Super Admin, stored in `platform_settings`.

The database is the only source of truth. A missing row means the default, and reading a
setting never writes one.
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import PlatformSetting

MEETING_REMINDER_KEY = "meeting_reminder"

# The choices the Super Admin is offered. The API accepts nothing else, so a reminder can
# never be scheduled at an arbitrary or nonsensical lead time.
REMINDER_LEAD_CHOICES = (5, 10, 15, 30, 60, 120, 1440)
DEFAULT_REMINDER = {"enabled": True, "lead_minutes": 5}


def get_reminder_config(db: Session) -> dict:
    row = db.query(PlatformSetting).filter(PlatformSetting.key == MEETING_REMINDER_KEY).first()
    value = dict(DEFAULT_REMINDER)
    if row and isinstance(row.value, dict):
        if isinstance(row.value.get("enabled"), bool):
            value["enabled"] = row.value["enabled"]
        if row.value.get("lead_minutes") in REMINDER_LEAD_CHOICES:
            value["lead_minutes"] = row.value["lead_minutes"]
    value["updated_at"] = row.updated_at.isoformat() if row and row.updated_at else None
    return value


def set_reminder_config(db: Session, *, enabled: bool, lead_minutes: int, updated_by: Optional[str]) -> dict:
    if lead_minutes not in REMINDER_LEAD_CHOICES:
        raise ValueError("Unsupported reminder time.")
    row = db.query(PlatformSetting).filter(PlatformSetting.key == MEETING_REMINDER_KEY).first()
    value = {"enabled": bool(enabled), "lead_minutes": int(lead_minutes)}
    if row is None:
        row = PlatformSetting(key=MEETING_REMINDER_KEY, value=value, updated_by=updated_by)
        db.add(row)
    else:
        row.value = value  # a new dict, so SQLAlchemy sees the JSON change
        row.updated_by = updated_by
    db.commit()
    return get_reminder_config(db)
