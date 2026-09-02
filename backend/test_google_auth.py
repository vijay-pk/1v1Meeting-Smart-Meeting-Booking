"""
Tests for Google sign-in (POST /api/auth/google and /api/auth/google/complete).

Supabase itself is stubbed: these cover what the backend decides once an identity is
verified -- account matching, the no-duplicates rule, username validation, and the
status gate -- plus that an unverifiable token is refused.

Rows are created and torn down per test, in the manner of test_payment_flow.py.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import User, AdminProfile, Session as SessionModel, AvailabilityRule
from app.services import supabase_auth
from app.api import auth as auth_api

client = TestClient(app)

VALID_TOKEN = "stub-valid-supabase-token"


@pytest.fixture
def stub_identity(monkeypatch):
    """Replaces Supabase verification with a controllable identity."""
    state = {"email": f"gtest_{uuid.uuid4().hex[:8]}@example.com", "name": "Google Test User"}

    async def fake_verify(access_token: str) -> dict:
        if access_token != VALID_TOKEN:
            raise supabase_auth.SupabaseAuthError("Your Google sign-in session is invalid or has expired.")
        return {
            "email": state["email"],
            "name": state["name"],
            "email_verified": True,
            "provider": "google",
            "avatar_url": "",
        }

    monkeypatch.setattr(auth_api, "verify_supabase_token", fake_verify)
    return state


@pytest.fixture
def cleanup_emails():
    """Removes any users created by a test, along with their dependent rows."""
    emails: list[str] = []
    yield emails

    db = SessionLocal()
    try:
        for email in emails:
            user = db.query(User).filter(User.email.ilike(email)).first()
            if not user:
                continue
            db.query(SessionModel).filter(SessionModel.admin_id == user.id).delete()
            db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == user.id).delete()
            db.query(AdminProfile).filter(AdminProfile.user_id == user.id).delete()
            db.delete(user)
        db.commit()
    finally:
        db.close()


def test_new_google_user_is_asked_for_a_username(stub_identity, cleanup_emails):
    cleanup_emails.append(stub_identity["email"])

    res = client.post("/api/auth/google", json={"supabase_access_token": VALID_TOKEN})

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "registration_required"
    assert body["email"] == stub_identity["email"]
    assert body["access_token"] is None
    # The suggestion must itself be usable, not merely present.
    assert body["suggested_username"]
    check = client.get("/api/auth/username-available", params={"username": body["suggested_username"]})
    assert check.json()["available"] is True


def test_complete_creates_a_working_admin_account(stub_identity, cleanup_emails):
    cleanup_emails.append(stub_identity["email"])
    username = f"gtest{uuid.uuid4().hex[:8]}"

    res = client.post(
        "/api/auth/google/complete",
        json={"supabase_access_token": VALID_TOKEN, "username": username},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "authenticated"
    assert body["access_token"]
    assert body["username"] == username
    assert body["role"] == "admin"

    # The token works, and the account got the same provisioning as password signup.
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == stub_identity["email"]

    public = client.get(f"/api/profiles/public/{username}")
    assert public.status_code == 200


def test_returning_google_user_signs_in_without_a_username_prompt(stub_identity, cleanup_emails):
    cleanup_emails.append(stub_identity["email"])
    username = f"gtest{uuid.uuid4().hex[:8]}"

    client.post(
        "/api/auth/google/complete",
        json={"supabase_access_token": VALID_TOKEN, "username": username},
    )

    # Second visit: the same Google account, arriving from either page.
    res = client.post("/api/auth/google", json={"supabase_access_token": VALID_TOKEN})

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "authenticated"
    assert body["username"] == username
    assert body["access_token"]


def test_google_never_creates_a_duplicate_account(stub_identity, cleanup_emails):
    cleanup_emails.append(stub_identity["email"])
    first = f"gtest{uuid.uuid4().hex[:8]}"
    second = f"gtest{uuid.uuid4().hex[:8]}"

    client.post(
        "/api/auth/google/complete",
        json={"supabase_access_token": VALID_TOKEN, "username": first},
    )
    # A user starting from Sign Up whose account already exists is signed in, and the
    # second username is ignored rather than producing a second row.
    res = client.post(
        "/api/auth/google/complete",
        json={"supabase_access_token": VALID_TOKEN, "username": second},
    )

    assert res.status_code == 200
    assert res.json()["username"] == first

    db = SessionLocal()
    try:
        count = db.query(User).filter(User.email.ilike(stub_identity["email"])).count()
    finally:
        db.close()
    assert count == 1


def test_google_signin_matches_an_existing_password_account(stub_identity, cleanup_emails):
    """A Google address that already signed up with a password links, never duplicates."""
    email = stub_identity["email"]
    cleanup_emails.append(email)
    username = f"gtest{uuid.uuid4().hex[:8]}"

    db = SessionLocal()
    try:
        user = auth_api.provision_admin(
            db,
            name="Existing Password User",
            email=email,
            username=username,
            password_hash=get_password_hash("somepassword"),
        )
        db.commit()
        user_id = user.id
    finally:
        db.close()

    res = client.post("/api/auth/google", json={"supabase_access_token": VALID_TOKEN})

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "authenticated"
    assert body["user_id"] == user_id
    assert body["username"] == username


def test_disabled_account_cannot_sign_in_with_google(stub_identity, cleanup_emails):
    """The status gate applies to Google exactly as it does to password login."""
    email = stub_identity["email"]
    cleanup_emails.append(email)
    username = f"gtest{uuid.uuid4().hex[:8]}"

    db = SessionLocal()
    try:
        user = auth_api.provision_admin(
            db,
            name="Disabled User",
            email=email,
            username=username,
            password_hash=get_password_hash("somepassword"),
        )
        user.status = "TEMPORARILY_DISABLED"
        db.commit()
    finally:
        db.close()

    res = client.post("/api/auth/google", json={"supabase_access_token": VALID_TOKEN})

    assert res.status_code == 403
    assert "disabled" in res.json()["detail"].lower()


def test_taken_username_is_rejected(stub_identity, cleanup_emails):
    cleanup_emails.append(stub_identity["email"])

    db = SessionLocal()
    try:
        taken = db.query(AdminProfile).first().username
    finally:
        db.close()

    res = client.post(
        "/api/auth/google/complete",
        json={"supabase_access_token": VALID_TOKEN, "username": taken},
    )

    assert res.status_code == 400
    assert "taken" in res.json()["detail"].lower()


def test_reserved_username_is_rejected(stub_identity, cleanup_emails):
    cleanup_emails.append(stub_identity["email"])

    res = client.post(
        "/api/auth/google/complete",
        json={"supabase_access_token": VALID_TOKEN, "username": "admin"},
    )

    assert res.status_code == 400
    assert "reserved" in res.json()["detail"].lower()


def test_malformed_username_is_rejected(stub_identity, cleanup_emails):
    cleanup_emails.append(stub_identity["email"])

    res = client.post(
        "/api/auth/google/complete",
        json={"supabase_access_token": VALID_TOKEN, "username": "a b!"},
    )

    assert res.status_code == 400


def test_invalid_token_is_refused(stub_identity):
    """An unverifiable token must never reach account creation."""
    res = client.post("/api/auth/google", json={"supabase_access_token": "forged"})
    assert res.status_code == 401

    res = client.post(
        "/api/auth/google/complete",
        json={"supabase_access_token": "forged", "username": f"gtest{uuid.uuid4().hex[:8]}"},
    )
    assert res.status_code == 401


def test_username_availability_endpoint(stub_identity):
    db = SessionLocal()
    try:
        taken = db.query(AdminProfile).first().username
    finally:
        db.close()

    assert client.get("/api/auth/username-available", params={"username": taken}).json()["available"] is False
    assert client.get("/api/auth/username-available", params={"username": "admin"}).json()["available"] is False
    free = f"gtest{uuid.uuid4().hex[:8]}"
    assert client.get("/api/auth/username-available", params={"username": free}).json()["available"] is True
