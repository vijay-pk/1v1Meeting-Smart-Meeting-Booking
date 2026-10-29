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

from app.core.security import get_password_hash, normalize_email, verify_password
from app.models.models import (
    User,
    StudentAllowance,
    StudentCredentialEmail,
    AllowanceAdjustment,
)
from app.services.admin_deletion import is_email_blocked

logger = logging.getLogger(__name__)

# THE temporary password for newly created students -- the only place it is defined. Both the
# stored hash (issue_temp_password) and the credentials email read this same constant, and the
# router re-checks the stored hash against it before every send (temp_password_is_current), so
# the password a student is emailed is provably the one set on their account.
# It is a shared, predictable value, which is acceptable only because must_change_password forces
# a replacement before the account can reach anything (deps.get_current_student).
# Changing it does NOT rehash existing students: they keep whatever password they already have.
TEMP_PASSWORD = "Adways@123"


class StudentCreationError(Exception):
    """Raised for a duplicate email or a blocked identity -- maps to 400 in the router."""


def issue_temp_password(user: User) -> str:
    """
    Puts the student on the temporary password: stores its bcrypt hash and sets
    must_change_password. The one way a temporary password is ever set. Returns the plaintext
    only so the caller can email it; it is never stored, logged or returned by an API.
    """
    user.password_hash = get_password_hash(TEMP_PASSWORD)
    user.must_change_password = True
    return TEMP_PASSWORD


def temp_password_is_current(user: User, password: str | None = None) -> bool:
    """
    True only if this account is a student still on the first-login flag whose stored hash
    verifies against `password` (default: TEMP_PASSWORD) right now. The gate before emailing
    credentials: if it is False the account does not have the password the email would claim.
    Callers that email a password pass that exact string, so what is verified and what is
    sent are the same value.
    """
    candidate = TEMP_PASSWORD if password is None else password
    return (
        user.role == "student"
        and bool(user.must_change_password)
        and verify_password(candidate, user.password_hash)
    )


def provision_student(db: Session, *, name: str, email: str, allocated: int, created_by: str) -> User:
    """
    Creates the student user + allowance + a pending credential-email row, flushes so ids
    exist, and returns the user. Does NOT commit and does NOT send the email -- the async
    router commits, then sends and records delivery. Never stores or returns the password.
    """
    clean_email = normalize_email(email)
    if not clean_email:
        raise StudentCreationError("A valid email is required.")

    # Duplicate-email validation against the ACTUAL account records, case-insensitively on the
    # normalized email. The outcome depends on what actually holds the email:
    existing = db.query(User).filter(User.email.ilike(clean_email)).first()
    if existing is not None:
        if existing.role != "student":
            # Belongs to an Admin, Super Admin or another account type -- never silently reused
            # for a student.
            raise StudentCreationError("This email belongs to another account and cannot be used for a student.")
        if existing.status == "PERMANENTLY_DELETED":
            # A student deleted under the old soft-delete flow (the row lingered and blocked the
            # email while the list hid it). Finish the cleanup now so the email is genuinely
            # released, then fall through and create the fresh account. Hard delete commits.
            logger.info("Reconciling a stale soft-deleted student to free email for reuse")
            delete_student_account(db, existing)
        else:
            # A live (active or disabled) student really owns this email.
            raise StudentCreationError("An account with this email already exists.")

    if is_email_blocked(db, clean_email):
        raise StudentCreationError("This email is not eligible to register.")

    student = User(
        name=(name or "").strip() or clean_email.split("@")[0],
        email=clean_email,
        password_hash="",  # replaced by issue_temp_password just below, before anything is stored
        role="student",
        status="ACTIVE",
    )
    issue_temp_password(student)
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


def delete_student_account(db: Session, student: User) -> dict:
    """
    Hard-deletes a student so their email becomes reusable, in a single transaction.

    Removed: the user row itself (this is what frees the email -- provision_student checks the
    users table), the allowance + its adjustment audit, policy acceptances, the credential-email
    audit, recording metadata, report-delivery audit, and any security-state row.

    Kept but anonymized: bookings (and their linked payments) survive as financial/history
    records, detached from the student (student_id NULL) with the client name/email/phone/notes
    stripped; upcoming confirmed/pending bookings are cancelled so the host's slots free up. The
    host's own Google Calendar events are never touched. Nothing is a soft flag -- the account
    is gone.

    Atomic: everything happens on one session and commits once; on any error the caller rolls
    back, so a partial delete is never left behind and success is reported only after the email
    is actually released.
    """
    from app.models.models import (
        Booking, MeetingRecording, StudentAllowance, AllowanceAdjustment,
        StudentPolicyAcceptance, StudentCredentialEmail, ReportDelivery, UserSecurityState,
    )

    sid = student.id
    now_iso = datetime.now(timezone.utc).isoformat()

    cancelled = 0
    for b in db.query(Booking).filter(Booking.student_id == sid).all():
        if b.status in ("confirmed", "pending_payment") and (b.start_time or "") > now_iso:
            b.status = "cancelled"
            from app.services.meeting_termination import cancel_termination_job
            cancel_termination_job(b)
            cancelled += 1
        b.student_id = None
        b.client_name = "Deleted student"
        b.client_email = ""
        b.client_phone = None
        b.notes = None

    # Recording metadata (no stored files while retrieval is gated off; when enabled, the file
    # deletion would happen here before the row is removed).
    db.query(MeetingRecording).filter(MeetingRecording.student_id == sid).delete(synchronize_session=False)
    db.query(AllowanceAdjustment).filter(AllowanceAdjustment.student_id == sid).delete(synchronize_session=False)
    db.query(StudentAllowance).filter(StudentAllowance.student_id == sid).delete(synchronize_session=False)
    db.query(StudentPolicyAcceptance).filter(StudentPolicyAcceptance.student_id == sid).delete(synchronize_session=False)
    db.query(StudentCredentialEmail).filter(StudentCredentialEmail.student_id == sid).delete(synchronize_session=False)
    db.query(ReportDelivery).filter(ReportDelivery.student_id == sid).delete(synchronize_session=False)
    db.query(UserSecurityState).filter(UserSecurityState.user_id == sid).delete(synchronize_session=False)

    # The user row last -- this is what frees the email address for reuse.
    db.delete(student)
    db.commit()
    return {"deleted": True, "cancelled_upcoming": cancelled}


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
