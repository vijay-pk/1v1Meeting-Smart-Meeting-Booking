import hashlib
import hmac
import logging
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.core.security import encrypt_secret
from app.models.models import User, GoogleConnection
from app.api.deps import get_current_admin
from app.services.google_calendar import (
    get_google_busy_intervals,
    GoogleCalendarUnavailable,
)

logger = logging.getLogger(__name__)

router = APIRouter()

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
]

# OAuth `state` must prove the callback belongs to the admin who started the flow. An
# unsigned admin id would let anyone bind their own Google account to another admin's
# calendar by hand-crafting the callback URL.
STATE_TTL_SECONDS = 600


def _sign_state(admin_id: str, issued_at: int) -> str:
    msg = f"{admin_id}.{issued_at}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()


def build_oauth_state(admin_id: str) -> str:
    issued_at = int(time.time())
    return f"{admin_id}.{issued_at}.{_sign_state(admin_id, issued_at)}"


def parse_oauth_state(state: str) -> str:
    """Returns the admin id carried by a valid state, or "" if it is forged or expired."""
    parts = state.split(".")
    if len(parts) != 3:
        return ""
    admin_id, issued_at_raw, signature = parts
    try:
        issued_at = int(issued_at_raw)
    except ValueError:
        return ""
    if not hmac.compare_digest(signature, _sign_state(admin_id, issued_at)):
        return ""
    if abs(int(time.time()) - issued_at) > STATE_TTL_SECONDS:
        return ""
    return admin_id

@router.get("/admin/status")
async def get_google_connection_status(
    probe: bool = Query(True, description="Verify the stored token can still read the calendar"),
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    Reports the stored connection *and* whether it still works.

    `connected` reflects the row; `healthy` reflects a live FreeBusy call. They diverge when
    the admin revoked access at Google — the row stays connected, but availability is failing
    closed and the admin needs to reconnect.
    """
    conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == current_admin.id).first()
    if not conn:
        return {"connected": False, "google_email": None, "healthy": False, "last_error": None}

    connected = conn.connection_status == "connected"
    payload = {
        "connected": connected,
        "google_email": conn.google_email,
        "calendar_id": conn.calendar_id,
        "connected_at": conn.created_at.isoformat() if conn.created_at else None,
        "healthy": False,
        "last_error": None,
    }

    if not connected or not probe:
        return payload

    now = datetime.now(timezone.utc)
    try:
        await get_google_busy_intervals(
            conn.encrypted_refresh_token,
            now.isoformat().replace("+00:00", "Z"),
            (now + timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
            conn.calendar_id or "primary"
        )
        payload["healthy"] = True
    except GoogleCalendarUnavailable as e:
        payload["last_error"] = str(e)

    return payload

@router.get("/auth-url")
def get_auth_url(current_admin: User = Depends(get_current_admin)):
    """Generates the Google OAuth consent screen URL for this admin."""
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        # Say so plainly instead of handing back a URL that only pretends to connect.
        return {
            "auth_url": None,
            "configured": False,
            "message": "Google OAuth is not configured on this server."
        }

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        # offline + consent is what makes Google return a refresh token.
        # select_account prompts the user to pick which Google/Gmail account to connect.
        "access_type": "offline",
        "prompt": "select_account consent",
        "include_granted_scopes": "true",
        "state": build_oauth_state(current_admin.id)
    }
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"
    return {"auth_url": auth_url, "configured": True}

@router.post("/admin/connect-mock")
def connect_mock_google_calendar(
    google_email: str = Query(..., description="Google email to associate"),
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    Enables a fake Google Calendar connection for local testing.

    Disabled unless ALLOW_MOCK_GOOGLE is on: this endpoint overwrites the admin's stored
    refresh token, so an accidental call would destroy a working integration and report
    success. A mock connection reads no calendar, so availability fails closed for it.
    """
    if not settings.ALLOW_MOCK_GOOGLE:
        raise HTTPException(
            status_code=403,
            detail="Mock Google connections are disabled. Connect a real Google account."
        )

    conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == current_admin.id).first()
    encrypted_refresh = encrypt_secret("mock_google_refresh_token_xyz")

    if not conn:
        conn = GoogleConnection(
            admin_id=current_admin.id,
            google_email=google_email.strip().lower(),
            encrypted_refresh_token=encrypted_refresh,
            connection_status="connected",
            calendar_id="primary"
        )
        db.add(conn)
    else:
        conn.google_email = google_email.strip().lower()
        conn.encrypted_refresh_token = encrypted_refresh
        conn.connection_status = "connected"

    db.commit()
    return {"message": "Google Calendar connected successfully", "google_email": conn.google_email}

@router.post("/admin/disconnect")
async def disconnect_google_calendar(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """
    The only path that ends a connection. Nothing else in the codebase may set
    connection_status to "disconnected" — a connection survives token errors, re-logins and
    profile syncs until the admin asks for it to end here.
    """
    conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == current_admin.id).first()
    if not conn:
        return {"message": "Google Calendar disconnected"}

    if conn.access_token:
        # Best effort: revoking at Google means the grant disappears from the admin's
        # account page too, not just from our database.
        try:
            async with httpx.AsyncClient() as client:
                await client.post(
                    "https://oauth2.googleapis.com/revoke",
                    data={"token": conn.access_token},
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=10.0
                )
        except Exception as e:
            logger.warning(f"Google token revoke failed for admin {current_admin.id}: {e}")

    conn.connection_status = "disconnected"
    conn.access_token = None
    conn.token_expiry = None
    db.commit()
    return {"message": "Google Calendar disconnected"}

def _get_frontend_url() -> str:
    url = (settings.APP_URL or "").rstrip("/")
    if not url or "localhost" in url:
        return "https://1v1-meeting-smart-meeting-booking.vercel.app"
    return url

@router.get("/callback")
async def google_oauth_callback(
    code: str = Query(...),
    state: str = Query(...),  # signed "<admin_id>.<issued_at>.<hmac>"
    db: Session = Depends(get_db)
):
    """Google OAuth redirect callback. Exchanges code for tokens and encrypts refresh token."""
    frontend_base = _get_frontend_url()
    admin_id = parse_oauth_state(state)
    if not admin_id:
        return RedirectResponse(f"{frontend_base}/admin/settings?tab=calendar&error=InvalidState")

    admin = db.query(User).filter(User.id == admin_id).first()
    if not admin:
        return RedirectResponse(f"{frontend_base}/admin/settings?tab=calendar&error=AdminNotFound")

    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.GOOGLE_REDIRECT_URI
            },
            timeout=10.0
        )
        data = res.json()
        if res.status_code != 200:
            logger.error(f"Google token exchange failed for admin {admin.id}: {data}")
            return RedirectResponse(f"{frontend_base}/admin/settings?tab=calendar&error=OAuthFailed")

        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
        expires_in = data.get("expires_in")

        # Get Google Email
        user_info_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        google_email = admin.email
        if user_info_res.status_code == 200:
            google_email = user_info_res.json().get("email", admin.email)

        conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == admin.id).first()

        # Without a refresh token the connection cannot outlive one hour. Storing a
        # placeholder and calling it "connected" is how a permanently dead integration ends
        # up reported as healthy — refuse instead, unless we already hold a working one.
        if not refresh_token and not conn:
            logger.error(f"Google returned no refresh token for admin {admin.id}")
            return RedirectResponse(
                f"{frontend_base}/admin/settings?tab=calendar&error=NoRefreshToken"
            )

        token_expiry = None
        if expires_in:
            try:
                token_expiry = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
            except (TypeError, ValueError):
                token_expiry = None

        if not conn:
            conn = GoogleConnection(
                admin_id=admin.id,
                google_email=google_email,
                access_token=access_token,
                encrypted_refresh_token=encrypt_secret(refresh_token),
                token_expiry=token_expiry,
                connection_status="connected",
                calendar_id="primary"
            )
            db.add(conn)
        else:
            conn.google_email = google_email
            conn.access_token = access_token
            conn.token_expiry = token_expiry
            if refresh_token:
                conn.encrypted_refresh_token = encrypt_secret(refresh_token)
            conn.connection_status = "connected"

        db.commit()
        return RedirectResponse(f"{frontend_base}/admin/settings?tab=calendar&connected=true")
