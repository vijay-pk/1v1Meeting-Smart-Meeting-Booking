"""
Student account creation, owned by the Super Admin.

A student is an ordinary `User` row with `role='student'` and `must_change_password=True`,
created with a shared temporary password. It reuses the exact same hashing (`get_password_hash`)
and status machine as every other account -- there is no parallel login system. The temporary
password is emailed once (never returned in an API response or logged) and the student must
replace it on first sign-in (enforced in deps.get_current_student).
"""
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.security import get_password_hash, normalize_email
from app.models.models import (
    User,
    StudentAllowance,
    StudentCredentialEmail,
    AllowanceAdjustment,
)
from app.services.admin_deletion import is_email_blocked

logger = logging.getLogger(__name__)

# Shared, predictable first-login password. Safe only because must_change_password forces a
# replacement before the account can do anything (deps.get_current_student).
TEMP_PASSWORD = "Admin@123"


class StudentCreationError(Exception):
    """Raised for a duplicate email or a blocked identity -- maps to 400 in the router."""


def provision_student(db: Session, *, name: str, email: str, allocated: int, created_by: str) -> User:
    """
    Creates the student user + allowance + a pending credential-email row, flushes so ids
    exist, and returns the user. Does NOT commit and does NOT send the email -- the async
    router commits, then sends and records delivery. Never stores or returns the password.
    """
    clean_email = normalize_email(email)
    if not clean_email:
        raise StudentCreationError("A valid email is required.")

    if db.query(User).filter(User.email.ilike(clean_email)).first():
        raise StudentCreationError("An account with this email already exists.")
    if is_email_blocked(db, clean_email):
        raise StudentCreationError("This email is not eligible to register.")

    student = User(
        name=(name or "").strip() or clean_email.split("@")[0],
        email=clean_email,
        password_hash=get_password_hash(TEMP_PASSWORD),
        role="student",
        status="ACTIVE",
        must_change_password=True,
    )
    db.add(student)
    db.flush()  # assign student.id

    alloc = max(0, int(allocated or 0))
    db.add(StudentAllowance(student_id=student.id, allocated=alloc))
    if alloc:
        db.add(AllowanceAdjustment(
            student_id=student.id, old_value=0, new_value=alloc,
            changed_by=created_by, reason="initial allocation",
        ))
    db.add(StudentCredentialEmail(student_id=student.id, status="pending", attempts=0))
    return student


def record_credential_delivery(db: Session, student_id: str, *, sent: bool, error: str | None = None) -> None:
    """Updates the student's credential-email audit row after an attempt."""
    row = (
        db.query(StudentCredentialEmail)
        .filter(StudentCredentialEmail.student_id == student_id)
        .order_by(StudentCredentialEmail.created_at.desc())
        .first()
    )
    if row is None:
        row = StudentCredentialEmail(student_id=student_id, attempts=0)
        db.add(row)
    row.attempts = (row.attempts or 0) + 1
    if sent:
        row.status = "sent"
        row.sent_at = datetime.now(timezone.utc)
        row.last_error = None
    else:
        row.status = "failed"
        row.last_error = (error or "send failed")[:255]
    db.commit()
