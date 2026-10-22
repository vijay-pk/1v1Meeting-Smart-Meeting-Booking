"""
Student meeting recordings.

Capability-gated by design. Google Meet recordings only exist when the host's account is Google
Workspace with recording enabled (started manually or by a Workspace admin auto-record policy);
the Meet API cannot start a recording. Retrieving one additionally needs a Drive OAuth scope the
app does not currently request. So until that external setup is done and
settings.RECORDING_RETRIEVAL_ENABLED is turned on, `recording_capability()` reports it
unsupported and the student dashboard shows an honest status -- a recording is never faked.

EXACT external requirement to enable (then flip RECORDING_RETRIEVAL_ENABLED on):
  1. Super Admin account = Google Workspace (Business Standard+/Education) with Meet recording
     enabled; optionally a Workspace Admin-console auto-record policy.
  2. Re-OAuth adding scope `https://www.googleapis.com/auth/drive.readonly` to the existing
     Meet/Calendar scopes (one re-consent by the Super Admin).
Retrieval path once enabled: for a student booking with a stored google_meet_space_id, poll Meet
REST v2 conferenceRecords.recordings.list for that space, resolve the Drive file id, and stream
it through the backend (or a short-lived signed URL) -- never a public Drive link.
"""
import logging

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import MeetingRecording, Booking

logger = logging.getLogger(__name__)


def recording_capability(db: Session) -> dict:
    """Whether automatic recording retrieval is configured. Honest, never optimistic."""
    if not settings.RECORDING_RETRIEVAL_ENABLED:
        return {
            "supported": False,
            "reason": "not_configured",
            "message": (
                "Automatic recording retrieval is not configured. It requires the host's Google "
                "Workspace account with Meet recording enabled and an added Drive permission."
            ),
        }
    return {"supported": True, "reason": None, "message": None}


def ensure_recording_row(db: Session, booking: Booking) -> MeetingRecording:
    """
    One recording row per student booking, created lazily. Its status reflects reality:
    `unsupported` while retrieval is off, otherwise `pending` until a real recording is found.
    """
    row = db.query(MeetingRecording).filter(MeetingRecording.booking_id == booking.id).first()
    if row is None:
        supported = settings.RECORDING_RETRIEVAL_ENABLED
        row = MeetingRecording(
            booking_id=booking.id,
            student_id=booking.student_id,
            space_name=booking.google_meet_space_id,
            status="pending" if supported else "unsupported",
            detail=None if supported else "Recording retrieval is not configured.",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def recording_out(row: MeetingRecording) -> dict:
    return {
        "booking_id": row.booking_id,
        "status": row.status,
        "title": row.title,
        "recorded_at": row.recorded_at.isoformat() if row.recorded_at else None,
        "detail": row.detail,
        # A play URL is served only when a recording is actually available; never a public link.
        "playable": row.status == "available",
    }
