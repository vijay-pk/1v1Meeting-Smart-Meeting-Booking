import urllib.parse
from datetime import datetime, timezone
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.core.security import encrypt_secret
from app.models.models import User, GoogleConnection
from app.api.deps import get_current_admin

router = APIRouter()

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email"
]

@router.get("/admin/status")
def get_google_connection_status(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == current_admin.id).first()
    if not conn:
        return {"connected": False, "google_email": None}

    return {
        "connected": conn.connection_status == "connected",
        "google_email": conn.google_email,
        "calendar_id": conn.calendar_id,
        "connected_at": conn.created_at.isoformat() if conn.created_at else None
    }

@router.get("/auth-url")
def get_auth_url(current_admin: User = Depends(get_current_admin)):
    """Generates the Google OAuth consent screen URL."""
    if not settings.GOOGLE_CLIENT_ID:
        # Return mock / simulation connect url
        return {
            "auth_url": f"{settings.APP_URL}/admin/settings?tab=calendar&simulated=true&email={current_admin.email}"
        }

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": current_admin.id
    }
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"
    return {"auth_url": auth_url}

@router.post("/admin/connect-mock")
def connect_mock_google_calendar(
    google_email: str = Query(..., description="Google email to associate"),
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    """Enables quick Google Calendar connection for local testing and demonstration."""
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
def disconnect_google_calendar(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == current_admin.id).first()
    if conn:
        conn.connection_status = "disconnected"
        db.commit()
    return {"message": "Google Calendar disconnected"}

@router.get("/callback")
async def google_oauth_callback(
    code: str = Query(...),
    state: str = Query(...),  # admin_id
    db: Session = Depends(get_db)
):
    """Google OAuth redirect callback. Exchanges code for tokens and encrypts refresh token."""
    admin = db.query(User).filter(User.id == state).first()
    if not admin:
        return RedirectResponse(f"{settings.APP_URL}/admin/settings?tab=calendar&error=AdminNotFound")

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
            return RedirectResponse(f"{settings.APP_URL}/admin/settings?tab=calendar&error=OAuthFailed")

        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")

        # Get Google Email
        user_info_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        google_email = admin.email
        if user_info_res.status_code == 200:
            google_email = user_info_res.json().get("email", admin.email)

        encrypted_refresh = encrypt_secret(refresh_token or "existing_token")

        conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == admin.id).first()
        if not conn:
            conn = GoogleConnection(
                admin_id=admin.id,
                google_email=google_email,
                access_token=access_token,
                encrypted_refresh_token=encrypted_refresh,
                connection_status="connected",
                calendar_id="primary"
            )
            db.add(conn)
        else:
            conn.google_email = google_email
            conn.access_token = access_token
            if refresh_token:
                conn.encrypted_refresh_token = encrypted_refresh
            conn.connection_status = "connected"

        db.commit()

    return RedirectResponse(f"{settings.APP_URL}/admin/settings?tab=calendar&connected=true")
