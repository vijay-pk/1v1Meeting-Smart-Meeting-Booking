"""
Development-only endpoints for exercising the student recording workflow without Google.

Every route is blocked by sim_guard(), which answers 404 unless
services.recording_sim.simulation_allowed() -- enforced here on the backend, per request, so
turning the UI off or hiding a button is never what keeps production safe. All routes also
require the Super Admin.

Seeded data is clearly marked: a student at sim-*@bookmymeet.test (a reserved, undeliverable
domain), a booking with a SIM- reference, a simulated space id, and a "[TEST]" title. No
real student is ever touched, and nothing here sends email.
"""
import secrets
import random
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_super_admin
from app.core.database import get_db
from app.models.models import Booking, MeetingRecording, User
from app.services.recording_providers import SimulatedProvider, TransitionError, process_recording
from app.services.recording_sim import (
    SIM_SPACE_PREFIX, TEST_EMAIL_DOMAIN, TEST_TITLE_PREFIX, is_simulated, is_test_email,
    simulation_allowed,
)
from app.services.student_accounts import StudentCreationError, provision_student


def sim_guard() -> None:
    if not simulation_allowed():
        raise HTTPException(status_code=404, detail="Not found")


router = APIRouter(dependencies=[Depends(sim_guard)])


class SeedRequest(BaseModel):
    student_id: Optional[str] = None


class AdvanceRequest(BaseModel):
    status: str


@router.post("/dev/recording-sim/seed")
def seed(body: SeedRequest, current: User = Depends(get_current_super_admin), db: Session = Depends(get_db)):
    """Creates (or reuses) a TEST student and a past TEST booking with a pending TEST recording."""
    if body.student_id:
        student = db.query(User).filter(User.id == body.student_id, User.role == "student").first()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        if not is_test_email(student.email):
            raise HTTPException(status_code=400, detail="Simulation only runs on TEST students (@%s)." % TEST_EMAIL_DOMAIN)
    else:
        try:
            student = provision_student(
                db, name="TEST Student", email=f"sim-{secrets.token_hex(4)}@{TEST_EMAIL_DOMAIN}",
                allocated=2, created_by=current.id,
            )
            db.commit()
            db.refresh(student)
        except StudentCreationError as exc:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # A past, randomised start so it never collides with the host's real slots (the unique
    # (admin_id, start_time) index) and the reminder/termination workers ignore it.
    start_s = None
    start = None
    for _ in range(20):
        start = datetime.now() - timedelta(days=random.randint(2, 60), minutes=random.randint(0, 1439))
        start_s = start.strftime("%Y-%m-%dT%H:%M:00Z")
        clash = db.query(Booking).filter(
            Booking.admin_id == current.id, Booking.start_time == start_s,
            Booking.status.in_(["confirmed", "pending_payment"]),
        ).first()
        if not clash:
            break
    end_s = (start + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:00Z")

    space = f"{SIM_SPACE_PREFIX}{secrets.token_hex(4)}"
    booking = Booking(
        public_id=f"SIM-{secrets.token_hex(4).upper()}",
        admin_id=current.id, meeting_type_id=None, student_id=student.id, category="student_free",
        client_name=student.name, client_email=student.email,
        start_time=start_s, end_time=end_s, timezone="Asia/Kolkata",
        status="confirmed", payment_status="free", attendance_status="pending",
        termination_status="not_applicable", grace_notified_at=datetime.now(timezone.utc).replace(tzinfo=None),
        google_meet_space_id=space, google_meet_link=None,
        cancellation_token=secrets.token_hex(16), reschedule_token=secrets.token_hex(16),
    )
    db.add(booking)
    db.flush()
    db.add(MeetingRecording(
        booking_id=booking.id, student_id=student.id, space_name=space, status="pending",
        title=f"{TEST_TITLE_PREFIX}Simulated session", detail="TEST: waiting for the meeting to end.",
    ))
    db.commit()
    return {
        "student_id": student.id, "student_email": student.email,
        "booking_id": booking.id, "public_id": booking.public_id, "recording_status": "pending",
    }


def _sim_row(db: Session, booking_id: str) -> MeetingRecording:
    row = db.query(MeetingRecording).filter(MeetingRecording.booking_id == booking_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Recording not found")
    if not is_simulated(row):
        raise HTTPException(status_code=400, detail="Not a simulated entry; refusing to modify a real recording.")
    return row


@router.post("/dev/recording-sim/{booking_id}/advance")
async def advance(booking_id: str, body: AdvanceRequest, current: User = Depends(get_current_super_admin), db: Session = Depends(get_db)):
    """Moves a simulated recording to pending / processing / available / unavailable (failed)."""
    row = _sim_row(db, booking_id)
    try:
        return await process_recording(db, row, SimulatedProvider(body.status))
    except TransitionError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/dev/recording-sim/{booking_id}")
def remove(booking_id: str, current: User = Depends(get_current_super_admin), db: Session = Depends(get_db)):
    """Deletes a simulated recording and its TEST booking. Never touches real data."""
    row = _sim_row(db, booking_id)
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    db.delete(row)
    if booking is not None and (booking.google_meet_space_id or "").startswith(SIM_SPACE_PREFIX):
        db.delete(booking)
    db.commit()
    return {"deleted": True}
