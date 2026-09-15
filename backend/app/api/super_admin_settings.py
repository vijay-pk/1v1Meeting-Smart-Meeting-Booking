"""
The Super Admin's own account, and the platform settings only they control.

Every route depends on get_current_super_admin, which re-reads the role from the database on
each request. An admin gets 403, an anonymous caller 401. Nothing here takes a user id from
the client: the account changed is always the one the token belongs to.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_super_admin
from app.core.database import get_db
from app.core.security import create_access_token, get_password_hash, normalize_email, verify_password
from app.models.models import AdminProfile, User, UserSecurityState
from app.services.platform_settings import REMINDER_LEAD_CHOICES, get_reminder_config, set_reminder_config

router = APIRouter()

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_BYTES = 72  # bcrypt ignores anything past this, so longer is refused, not truncated


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    # Required to change the username or email -- both are sign-in identifiers.
    current_password: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class ReminderSettingsUpdate(BaseModel):
    enabled: bool
    lead_minutes: int


def _account(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "username": user.profile.username if user.profile else None,
        "email": user.email,
        "role": user.role,
    }


def _require_current_password(user: User, current_password: Optional[str]) -> None:
    if not current_password or not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")


@router.get("/account")
def get_account(current: User = Depends(get_current_super_admin)):
    return _account(current)


@router.put("/account")
def update_account(
    body: AccountUpdate,
    current: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    from app.api.auth import check_username  # imported here: auth imports from this package

    new_name = body.name.strip() if body.name is not None else None
    if new_name is not None and not (1 <= len(new_name) <= 100):
        raise HTTPException(status_code=400, detail="Full name is required (up to 100 characters).")

    profile = current.profile
    current_username = profile.username if profile else None
    new_username = body.username.strip().lower() if body.username is not None else None
    username_changes = new_username is not None and new_username != current_username

    new_email = normalize_email(str(body.email)) if body.email is not None else None
    email_changes = new_email is not None and new_email != normalize_email(current.email)

    if username_changes or email_changes:
        _require_current_password(current, body.current_password)

    if username_changes:
        if profile is None:
            raise HTTPException(status_code=409, detail="This account has no booking profile to rename.")
        available, reason = check_username(db, new_username)
        if not available:
            raise HTTPException(status_code=400, detail=reason)

    if email_changes:
        taken = db.query(User).filter(User.email.ilike(new_email), User.id != current.id).first()
        if taken:
            raise HTTPException(status_code=400, detail="An account with this email already exists.")

    # One transaction: either every requested change lands or none does.
    if new_name is not None:
        current.name = new_name
    if username_changes:
        profile.username = new_username
    if email_changes:
        current.email = new_email
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That username or email was just taken. Please choose another.")
    db.refresh(current)
    return _account(current)


@router.post("/account/password")
def change_password(
    body: PasswordChange,
    current: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    _require_current_password(current, body.current_password)
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=400, detail="The new passwords do not match.")
    if len(body.new_password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=400, detail=f"Use at least {PASSWORD_MIN_LENGTH} characters.")
    if len(body.new_password.encode("utf-8")) > PASSWORD_MAX_BYTES:
        raise HTTPException(status_code=400, detail="That password is too long.")
    if verify_password(body.new_password, current.password_hash):
        raise HTTPException(status_code=400, detail="Choose a password different from the current one.")

    current.password_hash = get_password_hash(body.new_password)

    # Every session issued before this moment ends -- including any on a device the owner
    # no longer controls, which is usually why a password gets changed.
    now = datetime.now(timezone.utc).replace(microsecond=0)
    state = db.query(UserSecurityState).filter(UserSecurityState.user_id == current.id).first()
    if state is None:
        db.add(UserSecurityState(user_id=current.id, tokens_valid_after=now.replace(tzinfo=None)))
    else:
        state.tokens_valid_after = now.replace(tzinfo=None)
    db.commit()

    # A fresh token for the browser that made the change, so it is not signed out too.
    return {
        "message": "Password changed. Other sessions have been signed out.",
        "access_token": create_access_token(subject=current.id),
        "token_type": "bearer",
    }


@router.get("/settings/reminders")
def get_reminder_settings(
    current: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    return {**get_reminder_config(db), "choices": list(REMINDER_LEAD_CHOICES)}


@router.put("/settings/reminders")
def update_reminder_settings(
    body: ReminderSettingsUpdate,
    current: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
):
    if body.lead_minutes not in REMINDER_LEAD_CHOICES:
        raise HTTPException(status_code=400, detail="Choose one of the offered reminder times.")
    # Only the setting changes. Reminders already scheduled keep the lead time they were
    # created with, and no booking row is touched.
    config = set_reminder_config(db, enabled=body.enabled, lead_minutes=body.lead_minutes, updated_by=current.id)
    return {**config, "choices": list(REMINDER_LEAD_CHOICES)}
