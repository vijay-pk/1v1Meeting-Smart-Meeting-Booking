"""
Recording providers: one interface, a simulated implementation for development, and the real
Google Meet implementation.

process_recording() is the single place that moves a MeetingRecording between states and
triggers the "recording ready" notification, so swapping SimulatedProvider for a real provider
changes nothing else.

GoogleMeetProvider calls Meet REST v2 through services/recording_google.py. It is implemented
from Google's documentation and has NOT been verified against a live account: it needs a
Google Workspace host with Meet recording enabled and the recording scopes, and it only runs
when RECORDING_RETRIEVAL_ENABLED is on. See docs/RECORDING_SIMULATION.md.
"""
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Protocol

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import MeetingRecording, Booking, User, GoogleConnection
from app.services.recording_sim import (
    is_simulated, is_test_email, simulation_allowed, TEST_TITLE_PREFIX,
)

logger = logging.getLogger(__name__)

STATES = ("unsupported", "pending", "processing", "available", "unavailable")

# Allowed moves for SIMULATED rows. "unavailable" is the Failed state.
TRANSITIONS = {
    "pending": {"processing", "unavailable"},
    "processing": {"available", "unavailable"},
    "available": {"unavailable"},
    "unavailable": {"pending"},
    "unsupported": set(),
}

# Real rows follow what Google reports, which can skip a step (the first poll after a meeting
# may already find a finished file) and can recover (a recording that was missing appears
# later), so the rules are looser. The simulated table above stays strict.
REAL_TRANSITIONS = {
    "pending": {"processing", "available", "unavailable"},
    "processing": {"pending", "available", "unavailable"},
    "available": {"unavailable"},
    "unavailable": {"pending", "processing", "available"},
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
    Real retrieval through the host's Google account (Meet REST v2). It never invents an
    'available' recording: that status comes only from a FILE_GENERATED recording that Google
    lists. Anything it cannot determine leaves the status as it was and records why in `detail`.
    Raises RecordingTemporaryError for transient Google failures so the poll retries.
    NOT verified against a live Google account.
    """

    async def fetch(self, db: Session, row: MeetingRecording) -> RecordingResult:
        # Imported here so the simulation path never pulls in the Google modules.
        from app.services import recording_google
        from app.services.google_calendar import refresh_google_token
        from app.services.meeting_termination import booking_end_utc

        def unchanged(detail: str) -> RecordingResult:
            return RecordingResult(
                status=row.status, drive_file_id=row.drive_file_id, title=row.title,
                recorded_at=row.recorded_at, detail=detail,
            )

        booking = db.query(Booking).filter(Booking.id == row.booking_id).first()
        if booking is None or not row.space_name:
            return unchanged("No Google Meet space is recorded for this booking.")

        end = booking_end_utc(booking.end_time)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if end is None or now < end:
            return unchanged("Waiting for the meeting to end.")

        conn = (
            db.query(GoogleConnection)
            .filter(GoogleConnection.admin_id == booking.admin_id, GoogleConnection.connection_status == "connected")
            .first()
        )
        if conn is None or not conn.encrypted_refresh_token:
            return unchanged("Google is not connected for the host, so recordings cannot be retrieved.")

        try:
            token = await refresh_google_token(conn.encrypted_refresh_token)
        except Exception as exc:  # noqa: BLE001 -- revoked/invalid grants land here
            logger.warning("Could not refresh the Google token for recording %s: %s", row.id, exc.__class__.__name__)
            return unchanged(recording_google.PERMISSION_DETAIL)
        if token == "simulated-access-token":
            return unchanged("Google OAuth is not configured on this server.")

        found = await recording_google.lookup(
            token, row.space_name, ended_minutes_ago=(now - end).total_seconds() / 60.0,
        )
        title = row.title or (booking.meeting_type.title if booking.meeting_type else None)
        if found.state == "unchanged":
            return unchanged(found.detail or "")
        return RecordingResult(
            status=found.state, drive_file_id=found.drive_file_id or row.drive_file_id,
            title=title, recorded_at=found.recorded_at or row.recorded_at, detail=found.detail,
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
    # Simulated rows follow the strict table; real rows follow what Google reports.
    table = TRANSITIONS if is_simulated(row) else REAL_TRANSITIONS
    if result.status != row.status and result.status not in table.get(row.status, set()):
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
    One pass over REAL recordings that are waiting (simulated rows are advanced by hand, never
    here). A no-op unless RECORDING_RETRIEVAL_ENABLED is on. Only bookings whose scheduled end
    has passed are asked about; a transient Google failure leaves the row untouched so the next
    pass retries it, and one bad row never stops the others.
    """
    if not settings.RECORDING_RETRIEVAL_ENABLED:
        return {"scanned": 0, "reason": "retrieval_disabled"}

    from app.services.meeting_termination import booking_end_utc
    from app.services.recording_google import RecordingTemporaryError

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    summary = {"scanned": 0, "updated": 0, "retry_later": 0, "failed": 0}
    waiting = db.query(MeetingRecording).filter(MeetingRecording.status.in_(["pending", "processing"])).all()
    for row in waiting:
        if is_simulated(row):
            continue
        booking = db.query(Booking).filter(Booking.id == row.booking_id).first()
        end = booking_end_utc(booking.end_time) if booking else None
        if end is None or end > now:
            continue
        summary["scanned"] += 1
        before = (row.status, row.drive_file_id)
        try:
            await process_recording(db, row, GoogleMeetProvider())
            if (row.status, row.drive_file_id) != before:
                summary["updated"] += 1
        except RecordingTemporaryError as exc:
            db.rollback()
            summary["retry_later"] += 1
            logger.warning("Recording %s: temporary Google failure, will retry (%s)", row.id, exc)
        except Exception:  # noqa: BLE001
            db.rollback()
            summary["failed"] += 1
            logger.exception("Processing recording %s failed", row.id)
    return summary


async def recording_worker(stop: asyncio.Event) -> None:
    """
    The in-process loop. Server-side, so it keeps working when the student closes the browser.
    Started from main.py only when RECORDING_RETRIEVAL_ENABLED is on. A host that sleeps when
    idle should also call POST /api/internal/recordings/run from a scheduler.
    """
    from app.core.database import SessionLocal

    interval = max(30, settings.RECORDING_POLL_SECONDS)
    logger.info("Recording worker started (every %ss).", interval)
    while not stop.is_set():
        db = SessionLocal()
        try:
            summary = await process_due_recordings(db)
            if summary.get("scanned"):
                logger.info("Recordings: %s", summary)
        except Exception:  # noqa: BLE001 -- the loop must survive a bad run
            logger.exception("Recording run failed")
        finally:
            db.close()
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass
