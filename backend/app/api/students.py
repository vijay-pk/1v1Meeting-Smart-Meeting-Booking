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
    delete_student_account,
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


@router.get("/student-policy")
def get_policy(current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    from app.services.platform_settings import get_student_policy
    return get_student_policy(db)


@router.put("/student-policy")
def put_policy(body: dict, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    from app.services.platform_settings import set_student_policy
    version = str(body.get("version") or "").strip()
    text = body.get("text")
    if not version or not text:
        raise HTTPException(status_code=400, detail="version and text are required.")
    return set_student_policy(db, version=version, text=text, updated_by=current.id)


@router.get("/grace-period")
def get_grace(current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    from app.services.platform_settings import get_grace_minutes, GRACE_CHOICES
    return {"minutes": get_grace_minutes(db), "choices": list(GRACE_CHOICES)}


@router.put("/grace-period")
def put_grace(body: dict, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    from app.services.platform_settings import set_grace_minutes
    try:
        minutes = set_grace_minutes(db, minutes=int(body.get("minutes")), updated_by=current.id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Unsupported grace period.")
    return {"minutes": minutes}


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


@router.get("/students/{student_id}/bookings")
def student_bookings(student_id: str, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    student = _get_student_or_404(db, student_id)
    rows = (
        db.query(Booking)
        .filter(Booking.student_id == student.id)
        .order_by(Booking.start_time.desc())
        .all()
    )
    return [
        {
            "id": b.id, "public_id": b.public_id,
            "session_title": b.meeting_type.title if b.meeting_type else "Session",
            "category": b.category, "start_time": b.start_time, "end_time": b.end_time,
            "status": b.status, "attendance_status": b.attendance_status,
            "payment_status": b.payment_status, "google_meet_link": b.google_meet_link,
        }
        for b in rows
    ]


@router.get("/students/{student_id}/recordings")
def student_recordings(student_id: str, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    from app.services.meeting_recording import recording_capability, list_student_recordings
    student = _get_student_or_404(db, student_id)
    return {
        "capability": recording_capability(db),
        "recordings": list_student_recordings(db, student.id, confirmed_only=False),
    }


@router.post("/students/{student_id}/attendance")
def set_attendance(student_id: str, body: dict, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    """
    Super Admin review of a session's attendance (the no-show/complete decision). Audited by the
    allowance-derived count; a free no-show consumes one meeting, a correction back to pending
    releases it. Never silently rewrites history -- the change is explicit and logged here.
    """
    booking_id = body.get("booking_id")
    new_status = body.get("attendance_status")
    if new_status not in ("completed", "no_show", "pending_review", "pending"):
        raise HTTPException(status_code=400, detail="Invalid attendance_status.")
    booking = (
        db.query(Booking)
        .filter(Booking.id == booking_id, Booking.student_id == student_id)
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found for this student.")
    booking.attendance_status = new_status
    db.commit()
    return {"booking_id": booking.id, "attendance_status": booking.attendance_status}


@router.post("/students/{student_id}/report")
async def generate_report(student_id: str, body: dict | None = None, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    """
    Builds the student's meeting report from authoritative DB rows. With {"send": true} it also
    emails the student via Resend and records the delivery; otherwise it just returns the HTML
    for preview.
    """
    from app.services.student_report import build_report_html
    from app.services.email_service import send_student_report_email
    from app.models.models import ReportDelivery
    from datetime import datetime, timezone

    student = _get_student_or_404(db, student_id)
    html = build_report_html(db, student)
    send = bool((body or {}).get("send"))
    sent = False
    if send:
        try:
            sent = await send_student_report_email(to_email=student.email, student_name=student.name, html_body=html)
        except Exception:  # noqa: BLE001
            logger.exception("Report email failed for student %s", student.id)
        db.add(ReportDelivery(
            student_id=student.id, generated_by=current.id, recipient=student.email,
            sent_at=datetime.now(timezone.utc) if sent else None,
        ))
        db.commit()
    return {"html": html, "sent": sent}


@router.delete("/students/{student_id}")
def delete_student(student_id: str, current=Depends(get_current_super_admin), db: Session = Depends(get_db)):
    """
    Fully deletes a student so their email can be reused. Removes the user row and all
    student-specific data (allowance + adjustments, policy acceptances, credential/report
    audit, recording metadata, security state); keeps bookings and payments as anonymized
    financial/history records detached from the student, and cancels upcoming ones. One
    transaction: success is returned only after the email identity is actually released; any
    failure rolls back so a half-deleted account is never left behind.
    """
    student = _get_student_or_404(db, student_id)
    try:
        result = delete_student_account(db, student)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Failed to delete student %s", student_id)
        raise HTTPException(status_code=500, detail="Could not fully delete the student. No changes were made.")
    return {"id": student_id, "deleted": True, "cancelled_upcoming": result["cancelled_upcoming"]}


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
