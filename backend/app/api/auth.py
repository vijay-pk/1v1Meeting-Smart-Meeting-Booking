import logging
import re
import secrets
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import (
    verify_password, get_password_hash, create_access_token, normalize_email,
)
from app.models.models import User, AdminProfile, AvailabilityRule
from app.schemas.schemas import (
    UserLogin, UserSignup, Token, AdminProfileResponse,
    GoogleAuthRequest, GoogleAuthCompleteRequest, GoogleAuthResponse, UsernameAvailability,
)
from app.api.deps import get_current_user
from app.services.supabase_auth import (
    verify_supabase_token, SupabaseAuthError, SupabaseNotConfigured,
)
from app.services.admin_deletion import is_email_blocked, is_username_retired

router = APIRouter()
logger = logging.getLogger(__name__)

# Usernames that would collide with an application route. "/:username" is a catch-all
# in the frontend router, so nothing here may become a vanity page.
RESERVED_USERNAMES = {
    "admin", "super-admin", "login", "signup", "book", "api",
    "dashboard", "settings", "schedule",
}

USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{2,29}$")


def _token_response(user: User, username: str) -> dict:
    return {
        "access_token": create_access_token(subject=user.id),
        "token_type": "bearer",
        "role": user.role,
        "user_id": user.id,
        "username": username,
        "name": user.name,
        "status": user.status,
    }


def _google_authenticated(user: User, username: str) -> dict:
    """
    Shapes a signed-in Google response.

    _token_response() carries the account status under "status", which is also the
    discriminator field of GoogleAuthResponse; it is remapped to "account_status"
    here so the two cannot collide.
    """
    payload = _token_response(user, username)
    payload["account_status"] = payload.pop("status", None)
    payload["status"] = "authenticated"
    return payload


def _reject_unusable_account(user: User) -> None:
    """Applies the same status gate as password login. Shared by every sign-in path."""
    if user.status == "TEMPORARILY_DISABLED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your admin account is temporarily disabled. Please contact the platform administrator."
        )
    if user.status == "PERMANENTLY_DELETED":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been removed."
        )


BLOCKED_IDENTITY_MESSAGE = (
    "This account is no longer eligible to register as an Admin. "
    "Please contact the platform administrator if you believe this is a mistake."
)


def reject_blocked_identity(db: Session, email: str) -> None:
    """
    Refuses registration for an address that belonged to a permanently deleted admin.

    Enforced on the server for every registration path (password signup and both legs of
    Google sign-up), so a client that skips the UI cannot get around it. The check is on a
    keyed hash of the normalized address, so casing and surrounding whitespace cannot be
    used to slip past it.
    """
    if is_email_blocked(db, email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=BLOCKED_IDENTITY_MESSAGE,
        )


def check_username(db: Session, username: str) -> Tuple[bool, Optional[str]]:
    """Returns (available, reason_if_not). Single source of truth for username rules."""
    clean = (username or "").strip().lower()
    if not USERNAME_PATTERN.match(clean):
        return False, (
            "Use 3-30 characters: lowercase letters, numbers, dots, dashes or underscores, "
            "starting with a letter or number."
        )
    if clean in RESERVED_USERNAMES:
        return False, "This username is reserved. Please choose another."
    if db.query(AdminProfile).filter(AdminProfile.username == clean).first():
        return False, "This username is already taken. Please choose another."
    if is_username_retired(db, clean):
        # The vanity URL of a deleted admin is never reissued: old links pointing at it
        # must not resolve to somebody else's booking page.
        return False, "This username is no longer available. Please choose another."
    return True, None


def suggest_username(db: Session, name: str, email: str) -> str:
    """Derives a free username from the Google profile, as an editable starting point."""
    base = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
    if not base:
        base = re.sub(r"[^a-z0-9]+", "", email.split("@")[0].lower())
    base = (base or "user")[:24]
    if len(base) < 3:
        base = base + "user"

    candidate = base
    for _ in range(50):
        available, _reason = check_username(db, candidate)
        if available:
            return candidate
        candidate = base + str(secrets.randbelow(9000) + 1000)
    # Exhausting 50 tries is effectively impossible; fall back to a wider random space.
    return base + secrets.token_hex(4)


def provision_admin(
    db: Session,
    *,
    name: str,
    email: str,
    username: str,
    password_hash: str,
    phone: Optional[str] = None,
) -> User:
    """
    Creates an admin plus everything a usable page needs: profile, weekday availability,
    and three default session types.

    Shared by password signup and Google registration so both produce identical
    accounts. The caller commits.
    """
    new_user = User(
        name=name.strip(),
        email=email.strip().lower(),
        phone=phone.strip() if phone else None,
        password_hash=password_hash,
        role="admin",
        status="ACTIVE",
    )
    db.add(new_user)
    db.flush()

    db.add(AdminProfile(
        user_id=new_user.id,
        username=username,
        title="Mentor & Growth Consultant",
        bio="Hey! I am " + new_user.name + ". Book a 1:1 session with me to accelerate your growth.",
        heading_text=f"Book a 1:1 Session with {new_user.name}",
        welcome_message="Choose your session and pick a convenient time."
    ))

    # Default availability (Mon-Fri 09:00 - 18:00)
    for day in range(1, 6):
        db.add(AvailabilityRule(
            admin_id=new_user.id,
            day_of_week=day,
            start_time="09:00",
            end_time="18:00",
            is_active=True
        ))

    # No seeded sessions, and above all no seeded prices. Sessions priced by nobody used to
    # be active and sellable on the page of every admin who had never set a price, and they
    # made the "Active Meeting Type" setup step read as done for an admin who had done
    # nothing. An admin creates their own sessions during first-time setup.

    return new_user


async def _verified_google_identity(access_token: str) -> dict:
    """Resolves the Supabase token to a verified identity, or raises the right HTTP error."""
    try:
        return await verify_supabase_token(access_token)
    except SupabaseNotConfigured as exc:
        # A server misconfiguration, not a bad credential from the caller.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc)
        ) from exc
    except SupabaseAuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc)
        ) from exc


@router.post("/login", response_model=Token)
def login(login_data: UserLogin, db: Session = Depends(get_db)):
    identifier = normalize_email(login_data.username_or_email)
    user = (
        db.query(User)
        .join(AdminProfile, isouter=True)
        .filter((User.email.ilike(identifier)) | (AdminProfile.username == identifier))
        .first()
    )

    if not user or not verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username/email or password"
        )

    _reject_unusable_account(user)

    username = user.profile.username if user.profile else user.email.split("@")[0]
    return _token_response(user, username)


@router.post("/signup", response_model=Token)
def signup(signup_data: UserSignup, db: Session = Depends(get_db)):
    clean_username = signup_data.username.strip().lower()
    clean_email = normalize_email(signup_data.email)

    # Before anything is created: no user, no profile, no sessions, no availability.
    reject_blocked_identity(db, clean_email)

    available, reason = check_username(db, clean_username)
    if not available:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=reason)

    existing_email = db.query(User).filter(User.email.ilike(clean_email)).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists."
        )

    new_user = provision_admin(
        db,
        name=signup_data.name,
        email=clean_email,
        username=clean_username,
        password_hash=get_password_hash(signup_data.password),
        phone=signup_data.phone,
    )

    db.commit()
    db.refresh(new_user)

    return _token_response(new_user, clean_username)


@router.get("/username-available", response_model=UsernameAvailability)
def username_available(
    username: str = Query(..., min_length=1, max_length=60),
    db: Session = Depends(get_db),
):
    """Live availability check for the username step of Google registration."""
    clean = username.strip().lower()
    available, reason = check_username(db, clean)
    return {"username": clean, "available": available, "reason": reason}


@router.post("/google", response_model=GoogleAuthResponse)
async def google_auth(payload: GoogleAuthRequest, db: Session = Depends(get_db)):
    """
    First leg of Google sign-in, shared by the sign-in and sign-up pages.

    Existing account -> signed in immediately, with no username prompt.
    New Google address -> "registration_required" plus a suggested username, so the
    client can collect one and call /google/complete. Accounts are keyed on the
    verified email, so the same Google account never produces a duplicate user.
    """
    identity = await _verified_google_identity(payload.supabase_access_token)
    email = identity["email"]

    user = db.query(User).filter(User.email.ilike(email)).first()
    if user:
        _reject_unusable_account(user)
        username = user.profile.username if user.profile else email.split("@")[0]
        return _google_authenticated(user, username)

    # No account, and this address is tombstoned: do not offer registration at all. A
    # deleted admin must not be able to come back in through "Continue with Google".
    reject_blocked_identity(db, email)

    return {
        "status": "registration_required",
        "email": email,
        "name": identity["name"],
        "suggested_username": suggest_username(db, identity["name"], email),
    }


@router.post("/google/complete", response_model=GoogleAuthResponse)
async def google_auth_complete(payload: GoogleAuthCompleteRequest, db: Session = Depends(get_db)):
    """
    Second leg: creates the account for a new Google user under their chosen username.

    Email and name come from re-verifying the token, never from the request body, so a
    caller cannot register an address they do not control.
    """
    identity = await _verified_google_identity(payload.supabase_access_token)
    email = identity["email"]

    # Between the two legs the account may have appeared (a second tab, a retry).
    # Signing in beats failing, and it keeps this endpoint idempotent.
    existing = db.query(User).filter(User.email.ilike(email)).first()
    if existing:
        _reject_unusable_account(existing)
        username = existing.profile.username if existing.profile else email.split("@")[0]
        return _google_authenticated(existing, username)

    # Checked again on this leg, not just on /google: this endpoint creates the account,
    # so it must not rely on the caller having gone through the previous step.
    reject_blocked_identity(db, email)

    clean_username = payload.username.strip().lower()
    available, reason = check_username(db, clean_username)
    if not available:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=reason)

    # Google users authenticate through the provider, never with a local password. The
    # column is NOT NULL, so it gets a random hash nobody holds a preimage for --
    # password login on this account fails closed rather than being bypassable.
    try:
        new_user = provision_admin(
            db,
            name=identity["name"],
            email=email,
            username=clean_username,
            password_hash=get_password_hash(secrets.token_urlsafe(32)),
            phone=payload.phone,
        )

        db.commit()
        db.refresh(new_user)
    except Exception as exc:
        db.rollback()
        logger.exception("Failed to create admin in google_auth_complete: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not complete account setup: {str(exc)}"
        )

    return _google_authenticated(new_user, clean_username)


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = current_user.profile
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "phone": current_user.phone,
        "role": current_user.role,
        "status": current_user.status,
        "username": profile.username if profile else "",
        "title": profile.title if profile else "",
        "bio": profile.bio if profile else "",
        "profile_photo": profile.profile_photo if profile else "",
        "cover_image": profile.cover_image if profile else "",
        "intro_video": profile.intro_video if profile else "",
        "theme_settings": profile.theme_settings if profile else {},
        "social_links": profile.social_links if profile else {}
    }
