"""
Platform-wide settings owned by the Super Admin, stored in `platform_settings`.

The database is the only source of truth. A missing row means the default, and reading a
setting never writes one.
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import PlatformSetting

MEETING_REMINDER_KEY = "meeting_reminder"
STUDENT_POLICY_KEY = "student_policy"

# Default student meeting policy (version is bumped when the text materially changes, which
# re-prompts every student for acceptance). Editable by the Super Admin.
DEFAULT_STUDENT_POLICY = {
    "version": "1",
    "text": (
        "Please read these meeting rules before booking your sessions.\n\n"
        "1. You may cancel or reschedule a meeting up to 24 hours before its scheduled start time.\n"
        "2. Changes requested less than 24 hours before the meeting may not be permitted through the student dashboard.\n"
        "3. If you do not attend a booked session, or fail to cancel or reschedule within the permitted 24-hour period, the session may be counted against your available meeting balance.\n"
        "4. Free meeting allowances are managed by the Super Admin.\n"
        "5. Paid sessions are subject to the payment, cancellation, and refund rules shown during booking.\n"
        "6. If a recording is enabled, you will be notified and recording consent will be handled according to applicable law and provider policy.\n"
        "7. Your meeting history and eligible recordings may be available in your student dashboard.\n\n"
        "By selecting 'I Agree', you confirm that you have read and understood these rules."
    ),
}

def get_student_policy(db: Session) -> dict:
    row = db.query(PlatformSetting).filter(PlatformSetting.key == STUDENT_POLICY_KEY).first()
    value = dict(DEFAULT_STUDENT_POLICY)
    if row and isinstance(row.value, dict):
        if row.value.get("version"):
            value["version"] = str(row.value["version"])
        if row.value.get("text"):
            value["text"] = str(row.value["text"])
    return value


def set_student_policy(db: Session, *, version: str, text: str, updated_by: Optional[str]) -> dict:
    row = db.query(PlatformSetting).filter(PlatformSetting.key == STUDENT_POLICY_KEY).first()
    value = {"version": str(version).strip() or "1", "text": str(text)}
    if row is None:
        db.add(PlatformSetting(key=STUDENT_POLICY_KEY, value=value, updated_by=updated_by))
    else:
        row.value = value
        row.updated_by = updated_by
    db.commit()
    return get_student_policy(db)


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
