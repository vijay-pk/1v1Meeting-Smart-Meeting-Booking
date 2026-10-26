"""
Student meeting recordings.

Capability-gated by design. Google Meet recordings only exist when the host's account is Google
Workspace with recording enabled (started manually or by a Workspace admin auto-record policy);
the Meet API cannot start a recording on an individual account. Retrieving one additionally needs
OAuth scopes the app does not currently request. So until that external setup is done and
settings.RECORDING_RETRIEVAL_ENABLED is turned on, `recording_capability()` reports it
unsupported and the student dashboard shows an honest status -- a recording is never faked.

Development has a separate, explicitly TEST-labelled simulation (services/recording_sim.py and
recording_providers.py). Simulated entries are never shown as real recordings, have no video,
and are never emailed.

EXACT external requirement to enable real retrieval (then flip RECORDING_RETRIEVAL_ENABLED on):
  1. Host account = Google Workspace (Business Standard+/Education) with Meet recording enabled;
     optionally a Workspace Admin-console auto-record policy.
  2. Re-OAuth adding scopes meetings.space.settings, meetings.space.readonly and drive.readonly
     (one re-consent by the host).
See docs/RECORDING_SIMULATION.md and services/recording_providers.py for the retrieval path.
"""
import logging

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import MeetingRecording, Booking
from app.services.recording_sim import (
    is_simulated_space, is_simulated, simulation_allowed, SIM_SPACE_PREFIX, TEST_LABEL,
)

logger = logging.getLogger(__name__)


def recording_capability(db: Session) -> dict:
    """Whether automatic recording retrieval is configured. Honest, never optimistic."""
    if not settings.RECORDING_RETRIEVAL_ENABLED:
        return {
            "supported": False,
            "reason": "not_configured",
            "message": (
                "Automatic recording retrieval is not configured. It requires the host's Google "
                "Workspace account with Meet recording enabled and added Meet/Drive permissions."
            ),
            "simulation": simulation_allowed(),
        }
    return {"supported": True, "reason": None, "message": None, "simulation": False}


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
    sim = is_simulated(row)
    return {
        "booking_id": row.booking_id,
        "status": row.status,
        "title": row.title,
        "recorded_at": row.recorded_at.isoformat() if row.recorded_at else None,
        "detail": row.detail,
        # Simulated entries are flagged and labelled and are never playable: they have no video.
        "simulated": sim,
        "test_label": TEST_LABEL if sim else None,
        "playable": row.status == "available" and not sim,
    }


def list_student_recordings(db: Session, student_id: str, *, confirmed_only: bool) -> list[dict]:
    """
    A student's recordings, one per booking that has a Meet space. Shared by the student and
    Super Admin endpoints so both apply the same rules. Simulated entries are hidden entirely
    whenever simulation is not allowed (e.g. a dev database copied somewhere real).
    """
    q = db.query(Booking).filter(Booking.student_id == student_id, Booking.google_meet_space_id.isnot(None))
    if confirmed_only:
        q = q.filter(Booking.status == "confirmed")
    allowed = simulation_allowed()
    items = []
    for b in q.order_by(Booking.start_time.desc()).all():
        if is_simulated_space(b.google_meet_space_id) and not allowed:
            continue
        row = ensure_recording_row(db, b)
        out = recording_out(row)
        out["session_title"] = b.meeting_type.title if b.meeting_type else (row.title or "Session")
        out["start_time"] = b.start_time
        items.append(out)
    return items


__all__ = [
    "recording_capability", "ensure_recording_row", "recording_out",
    "list_student_recordings", "SIM_SPACE_PREFIX",
]
