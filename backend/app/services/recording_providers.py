"""
Recording providers: one interface, a simulated implementation for development, and a stub
for the real Google Meet retrieval that will replace it.

process_recording() is the single place that moves a MeetingRecording between states and
triggers the "recording ready" notification, so swapping SimulatedProvider for a real provider
changes nothing else.

Real retrieval (NOT implemented, NOT verified against Google): after a conference ends, call
Meet REST v2 conferenceRecords.list (filter=space.name="<space>") then
conferenceRecords.recordings.list, read recordings[].driveDestination.file, and stream or
link that Drive file through the backend. It needs a Google Workspace host account with
recording enabled and the scopes meetings.space.readonly (+ drive.readonly), neither of which
the app requests today. See docs/RECORDING_SIMULATION.md.
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Protocol

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import MeetingRecording, Booking, User
from app.services.recording_sim import (
    is_simulated, is_test_email, simulation_allowed, TEST_TITLE_PREFIX,
)

logger = logging.getLogger(__name__)

STATES = ("unsupported", "pending", "processing", "available", "unavailable")

# Allowed moves. "unavailable" is the Failed state (also: the file was removed later).
TRANSITIONS = {
    "pending": {"processing", "unavailable"},
    "processing": {"available", "unavailable"},
    "available": {"unavailable"},
    "unavailable": {"pending"},
    "unsupported": set(),
}


class TransitionError(ValueError):
    pass


@dataclass
class RecordingResult:
    status: str
    drive_file_id: Optional[str] = None
    title: Optional[str] = None
    recorded_at: Optional[datetime] = None
    detail: Optional[str] = None


class RecordingProvider(Protocol):
    async def fetch(self, db: Session, row: MeetingRecording) -> RecordingResult: ...


class SimulatedProvider:
    """Returns whatever state it is told to. No I/O, no media, no Google."""

    def __init__(self, target_status: str):
        self.target_status = target_status

    async def fetch(self, db: Session, row: MeetingRecording) -> RecordingResult:
        title = row.title or f"{TEST_TITLE_PREFIX}Simulated session"
        if not title.startswith(TEST_TITLE_PREFIX):
            title = TEST_TITLE_PREFIX + title
        detail = {
            "pending": "TEST: waiting for the meeting to end.",
            "processing": "TEST: simulated processing.",
            "available": "TEST: simulated recording (no video exists).",
            "unavailable": "TEST: simulated failure.",
        }.get(self.target_status)
        return RecordingResult(
            status=self.target_status,
            title=title,
            recorded_at=datetime.now(timezone.utc).replace(tzinfo=None) if self.target_status == "available" else None,
            detail=detail,
        )


class GoogleMeetProvider:
    """
    Placeholder for real Meet artifact retrieval. Makes NO network calls and changes nothing,
    so it can never fabricate an 'available' recording. Replace fetch() with the Meet v2 +
    Drive calls described in the module docstring.
    """

    async def fetch(self, db: Session, row: MeetingRecording) -> RecordingResult:
        return RecordingResult(
            status=row.status, drive_file_id=row.drive_file_id, title=row.title,
            recorded_at=row.recorded_at, detail="Retrieval not implemented.",
        )


def get_provider(row: MeetingRecording, target: Optional[str] = None) -> Optional[RecordingProvider]:
    """Pick the provider for a row; None when nothing can handle it."""
    if is_simulated(row):
        return SimulatedProvider(target or row.status) if simulation_allowed() else None
    if settings.RECORDING_RETRIEVAL_ENABLED:
        return GoogleMeetProvider()
    return None


async def notify_if_ready(db: Session, row: MeetingRecording) -> dict:
    """
    Sends the 'recording ready' email at most once, and only for a REAL available recording.

    Simulated rows never reach the email sender (the link would be a lie and the student is a
    test account). A claim UPDATE on email_sent_at makes repeated calls and concurrent workers
    send exactly one email; a failed send releases the claim so it can be retried.
    """
    if row.status != "available":
        return {"sent": False, "reason": "not_available"}
    if is_simulated(row):
        logger.info("Recording-ready notification suppressed for simulated entry %s", row.id)
        return {"sent": False, "suppressed": True, "reason": "simulated"}

    student = db.query(User).filter(User.id == row.student_id).first() if row.student_id else None
    if not student:
        return {"sent": False, "reason": "no_student"}
    if is_test_email(student.email):
        return {"sent": False, "suppressed": True, "reason": "test_address"}

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    claimed = (
        db.query(MeetingRecording)
        .filter(MeetingRecording.id == row.id, MeetingRecording.email_sent_at.is_(None))
        .update({MeetingRecording.email_sent_at: now}, synchronize_session=False)
    )
    db.commit()
    if claimed != 1:
        return {"sent": False, "reason": "already_sent"}

    booking = db.query(Booking).filter(Booking.id == row.booking_id).first()
    title = (booking.meeting_type.title if booking and booking.meeting_type else None) or row.title or "Session"
    date = (booking.start_time or "")[:10] if booking else ""

    # Looked up at call time so tests can substitute the sender.
    from app.services import email_service

    ok = False
    try:
        ok = await email_service.send_recording_ready_email(
            to_email=student.email, student_name=student.name, meeting_title=title,
            meeting_date=date, dashboard_url=f"{settings.APP_URL.rstrip('/')}/student/recordings",
        )
    except Exception:  # noqa: BLE001
        logger.exception("Recording-ready email failed for recording %s", row.id)
    if not ok:
        db.query(MeetingRecording).filter(MeetingRecording.id == row.id).update(
            {MeetingRecording.email_sent_at: None, MeetingRecording.detail: "Notification email failed; will retry."},
            synchronize_session=False,
        )
        db.commit()
        return {"sent": False, "reason": "send_failed"}
    return {"sent": True}


async def process_recording(db: Session, row: MeetingRecording, provider: RecordingProvider) -> dict:
    """Ask the provider for the current state, apply a valid transition, then notify."""
    result = await provider.fetch(db, row)
    if result.status not in STATES:
        raise TransitionError(f"Unknown status {result.status!r}.")
    if result.status != row.status and result.status not in TRANSITIONS.get(row.status, set()):
        raise TransitionError(f"Cannot move a recording from {row.status} to {result.status}.")

    row.status = result.status
    if result.drive_file_id is not None:
        row.drive_file_id = result.drive_file_id
    if result.title is not None:
        row.title = result.title
    if result.recorded_at is not None:
        row.recorded_at = result.recorded_at
    row.detail = (result.detail or "")[:255] or None
    db.commit()
    db.refresh(row)

    notification = await notify_if_ready(db, row)
    return {"status": row.status, "notification": notification}


async def process_due_recordings(db: Session) -> dict:
    """
    Worker entry point for REAL rows (simulated rows are advanced by hand, never here).
    A no-op until RECORDING_RETRIEVAL_ENABLED is on and GoogleMeetProvider is implemented.
    """
    if not settings.RECORDING_RETRIEVAL_ENABLED:
        return {"scanned": 0, "reason": "retrieval_disabled"}
    scanned = 0
    for row in db.query(MeetingRecording).filter(MeetingRecording.status.in_(["pending", "processing"])).all():
        if is_simulated(row):
            continue
        scanned += 1
        try:
            await process_recording(db, row, GoogleMeetProvider())
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("Processing recording %s failed", row.id)
    return {"scanned": scanned}
