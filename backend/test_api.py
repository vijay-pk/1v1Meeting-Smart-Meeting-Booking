"""
Integration tests over the public API surface.

These used to depend on seed state: they logged in as a literal `arun` account that an
earlier run happened to leave behind, and asserted a hardcoded super-admin password. That
made them pass only against a dirty database and leave a new orphan admin behind on every
run. Each test now builds the accounts it needs and deletes them afterwards, so the suite
is order-independent and adds nothing permanent to the database.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.core.config import settings
from app.core.database import SessionLocal
from app.models.models import (
    User,
    AdminProfile,
    Session as SessionModel,
    AvailabilityRule,
    AvailabilityException,
    GoogleConnection,
    RazorpayConnection,
    SlotLock,
    Notification,
)

# Ensures the schema exists and a super admin is present. Creates nothing else -- the
# bootstrap is deliberately the only account the application ever makes for itself.
seed_initial_data()
client = TestClient(app)

ADMIN_PASSWORD = "SecurePassword123!"


@pytest.fixture
def admin_account():
    """A freshly signed-up admin, removed again when the test finishes."""
    uid = uuid.uuid4().hex[:8]
    username = f"apitest{uid}"
    email = f"apitest_{uid}@testdomain.com"

    res = client.post("/api/auth/signup", json={
        "name": "API Test Admin",
        "email": email,
        "password": ADMIN_PASSWORD,
        "phone": "+919876500000",
        "username": username,
    })
    assert res.status_code == 200, res.text
    data = res.json()

    yield {
        "id": data["user_id"],
        "username": username,
        "email": email,
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
    }

    db = SessionLocal()
    try:
        admin_id = data["user_id"]
        for model, column in [
            (Notification, Notification.admin_id),
            (SlotLock, SlotLock.admin_id),
            (AvailabilityException, AvailabilityException.admin_id),
            (AvailabilityRule, AvailabilityRule.admin_id),
            (GoogleConnection, GoogleConnection.admin_id),
            (RazorpayConnection, RazorpayConnection.admin_id),
            (SessionModel, SessionModel.admin_id),
        ]:
            db.query(model).filter(column == admin_id).delete(synchronize_session=False)
        db.query(AdminProfile).filter(AdminProfile.user_id == admin_id).delete(synchronize_session=False)
        db.query(User).filter(User.id == admin_id).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def super_admin_headers():
    """Authenticates as the bootstrapped super admin, using the configured credentials."""
    res = client.post("/api/auth/login", json={
        "username_or_email": settings.SUPER_ADMIN_USERNAME,
        "password": settings.SUPER_ADMIN_PASSWORD,
    })
    assert res.status_code == 200, (
        "Could not log in as the configured super admin. SUPER_ADMIN_USERNAME / "
        "SUPER_ADMIN_PASSWORD in backend/.env must match the bootstrapped account."
    )
    assert res.json()["role"] == "super_admin"
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_super_admin_login(super_admin_headers):
    assert super_admin_headers["Authorization"].startswith("Bearer ")


def test_admin_signup_and_profile(admin_account):
    profile_res = client.get(f"/api/profiles/public/{admin_account['username']}")
    assert profile_res.status_code == 200
    pdata = profile_res.json()
    assert pdata["username"] == admin_account["username"]
    assert pdata["name"] == "API Test Admin"
    assert pdata["status"] == "ACTIVE"


def test_admin_profile_customization(admin_account):
    update_res = client.put("/api/profiles/me", headers=admin_account["headers"], json={
        "title": "Lead Product Strategist",
        "bio": "10x conversion rate optimization expert.",
        "intro_video": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "heading_text": "Accelerate your brand",
        "theme_settings": {"theme": "emerald", "button_color": "#059669"},
        "social_links": {"linkedin": "https://linkedin.com/in/example"},
    })
    assert update_res.status_code == 200

    pub = client.get(f"/api/profiles/public/{admin_account['username']}").json()
    assert pub["title"] == "Lead Product Strategist"
    assert pub["intro_video"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert pub["theme_settings"]["button_color"] == "#059669"


def test_super_admin_management_and_disable(admin_account, super_admin_headers):
    admins_res = client.get("/api/super-admin/admins", headers=super_admin_headers)
    assert admins_res.status_code == 200
    listed = next(a for a in admins_res.json() if a["id"] == admin_account["id"])

    disable_res = client.put(
        f"/api/super-admin/admins/{listed['id']}/status",
        headers=super_admin_headers,
        json={"status": "TEMPORARILY_DISABLED"},
    )
    assert disable_res.status_code == 200
    assert disable_res.json()["status"] == "TEMPORARILY_DISABLED"

    disabled_login = client.post("/api/auth/login", json={
        "username_or_email": admin_account["email"],
        "password": ADMIN_PASSWORD,
    })
    assert disabled_login.status_code == 403

    pub = client.get(f"/api/profiles/public/{admin_account['username']}").json()
    assert pub["status"] == "TEMPORARILY_DISABLED"
    assert len(pub["sessions"]) == 0

    enable_res = client.put(
        f"/api/super-admin/admins/{listed['id']}/status",
        headers=super_admin_headers,
        json={"status": "ACTIVE"},
    )
    assert enable_res.status_code == 200
    assert enable_res.json()["status"] == "ACTIVE"


def test_slot_lock_double_booking_protection(admin_account):
    """The double-booking guard: a second hold on the same slot must be refused."""
    # Signup seeds no sessions, so this test creates the one it locks a slot against.
    created = client.post("/api/sessions/", headers=admin_account["headers"], json={
        "title": "Slot Lock Session", "description": "", "duration_minutes": 15,
        "price": 99900, "currency": "INR", "is_active": True,
    })
    assert created.status_code == 200, created.text
    session_id = created.json()["id"]

    profile = client.get(f"/api/profiles/public/{admin_account['username']}").json()
    admin_id = profile["id"]

    slot = {
        "admin_id": admin_id,
        "session_id": session_id,
        "start_time": "2030-09-15T10:00:00Z",
        "end_time": "2030-09-15T10:15:00Z",
    }

    lock_a = client.post("/api/bookings/hold-slot", json={**slot, "session_fingerprint": "client_a"})
    assert lock_a.status_code == 200
    lock_id = lock_a.json()["lock_id"]

    lock_b = client.post("/api/bookings/hold-slot", json={**slot, "session_fingerprint": "client_b"})
    assert lock_b.status_code == 409

    client.post(f"/api/bookings/release-hold/{lock_id}")
