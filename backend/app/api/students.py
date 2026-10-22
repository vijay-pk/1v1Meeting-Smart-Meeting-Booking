"""
Super Admin student management: create/list/edit students, manage free allowances (audited),
status, and resend credentials. Every endpoint is gated by get_current_super_admin -- a normal
admin or client receives 403. Students are scoped here only by the Super Admin; the student's
own portal lives in api/student_portal.py.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.api.deps import get_current_super_admin
from app.models.models import (
    User, Booking, StudentAllowance, AllowanceAdjustment, StudentCredentialEmail,
)
from app.schemas.schemas import (
    StudentCreate, StudentUpdate, AllowanceAdjustRequest, StudentStatusUpdate,
)
from app.services import student_allowance
from app.services.student_accounts import (
    provision_student, record_credential_delivery, StudentCreationError, TEMP_PASSWORD,
)
from app.core.security import get_password_hash, normalize_email
from app.services.email_service import send_student_credentials_email

logger = logging.getLogger(__name__)
router = APIRouter()


def _login_url() -> str:
    return f"{settings.APP_URL.rstrip('/')}/admin/login"


def _credential_status(db: Session, student_id: str) -> dict:
    row = (
        db.query(StudentCredentialEmail)
        .filter(StudentCredentialEmail.student_id == student_id)
        .order_by(StudentCredentialEmail.created_at.desc())
        .first()
    )
    if not row:
        return {"status": "unknown", "attempts": 0}
    return {
        "status": row.status,
        "attempts": row.attempts,
        "last_error": row.last_error,
        "sent_at": row.sent_at.isoformat() if row.sent_at else None,
    }


def _student_row(db: Session, student: User, *, detail: bool = False) -> dict:
    summ = student_allowance.summary(db, student.id)
    upcoming = (
        db.query(Booking)
        .filter(
            Booking.student_id == student.id,
            Booking.status == "confirmed",
            Booking.start_time > datetime.now(timezone.utc).isoformat(),
        )
        .count()
    )
    paid = (
        db.query(Booking)
        .filter(Booking.student_id == student.id, Booking.category == "student_paid")
        .count()
    )
    out = {
        "id": student.id,
        "name": student.name,
        "email": student.email,
        "status": student.status,
        "must_change_password": bool(student.must_change_password),
        "allocated": summ["allocated"],
        "completed": summ["completed"],
        "remaining": summ["available"],
        "upcoming": upcoming,
        "paid_sessions": paid,
        "created_at": student.created_at.isoformat() if student.created_at else None,
        "credential_email": _credential_status(db, student.id),
    }
    if detail:
        out["adjustments"] = [
            {
                "old_value": a.old_value, "new_value": a.new_value,
                "changed_by": a.changed_by, "reason": a.reason,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in db.query(AllowanceAdjustment)
            .filter(AllowanceAdjustment.student_id == student.id)
            .order_by(AllowanceAdjustment.created_at.desc())
            .all()
        ]
    return out


def _get_student_or_404(db: Session, student_id: str) -> User:
    student = db.query(User).filter(User.id == student_id, User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


@router.get("/students")
def list_students(current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    students = (
        db.query(User)
        .filter(User.role == "student", User.status != "PERMANENTLY_DELETED")
        .order_by(User.created_at.desc())
        .all()
    )
    return [_student_row(db, s) for s in students]


@router.get("/students/{student_id}")
def get_student(student_id: str, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    student = _get_student_or_404(db, student_id)
    return _student_row(db, student, detail=True)


@router.post("/students")
async def create_student(body: StudentCreate, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    try:
        student = provision_student(
            db, name=body.name, email=body.email, allocated=body.allocated, created_by=current.id,
        )
        db.commit()
        db.refresh(student)
    except StudentCreationError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Email the credentials after commit; never fatal to account creation. Record delivery.
    sent = False
    try:
        sent = await send_student_credentials_email(
            to_email=student.email, student_name=student.name,
            temp_password=TEMP_PASSWORD, login_url=_login_url(),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Credential email failed for student %s", student.id)
    record_credential_delivery(db, student.id, sent=sent, error=None if sent else "send failed")

    row = _student_row(db, student, detail=True)
    row["credential_email_sent"] = sent
    return row


@router.put("/students/{student_id}")
def update_student(student_id: str, body: StudentUpdate, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    student = _get_student_or_404(db, student_id)
    if body.name is not None:
        student.name = body.name.strip() or student.name
    if body.email is not None:
        clean = normalize_email(body.email)
        if clean != student.email:
            if db.query(User).filter(User.email.ilike(clean), User.id != student.id).first():
                raise HTTPException(status_code=400, detail="Another account already uses this email.")
            student.email = clean
    db.commit()
    db.refresh(student)
    return _student_row(db, student, detail=True)


@router.post("/students/{student_id}/status")
def set_student_status(student_id: str, body: StudentStatusUpdate, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    student = _get_student_or_404(db, student_id)
    if body.status not in ("ACTIVE", "TEMPORARILY_DISABLED"):
        raise HTTPException(status_code=400, detail="status must be ACTIVE or TEMPORARILY_DISABLED.")
    student.status = body.status
    db.commit()
    db.refresh(student)
    return _student_row(db, student)


@router.post("/students/{student_id}/allowance")
def adjust_allowance(student_id: str, body: AllowanceAdjustRequest, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    student = _get_student_or_404(db, student_id)
    new_value = int(body.allocated)
    if new_value < 0:
        raise HTTPException(status_code=400, detail="Allocation cannot be negative.")
    used = student_allowance.consumed(db, student.id)
    if new_value < used:
        raise HTTPException(
            status_code=400,
            detail=f"Allocation cannot be below the {used} meeting(s) already used.",
        )
    old_value = student_allowance.allocated(db, student.id)
    if new_value != old_value:
        student_allowance.set_allocation(db, student.id, new_value)
        db.add(AllowanceAdjustment(
            student_id=student.id, old_value=old_value, new_value=new_value,
            changed_by=current.id, reason=(body.reason or None),
        ))
        db.commit()
    return _student_row(db, student, detail=True)


@router.post("/students/{student_id}/resend-credentials")
async def resend_credentials(student_id: str, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    student = _get_student_or_404(db, student_id)
    # Reset to the temporary password (the stored hash can't be read back) and force a change
    # again, so the resent credentials are actually usable.
    student.password_hash = get_password_hash(TEMP_PASSWORD)
    student.must_change_password = True
    db.commit()
    sent = False
    try:
        sent = await send_student_credentials_email(
            to_email=student.email, student_name=student.name,
            temp_password=TEMP_PASSWORD, login_url=_login_url(),
        )
    except Exception:  # noqa: BLE001
        logger.exception("Resend credential email failed for student %s", student.id)
    record_credential_delivery(db, student.id, sent=sent, error=None if sent else "send failed")
    return {"sent": sent, "credential_email": _credential_status(db, student.id)}
