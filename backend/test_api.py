import pytest
from fastapi.testclient import TestClient
from app.main import app, seed_initial_data
from app.core.database import Base, engine

seed_initial_data()
client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_super_admin_login():
    response = client.post("/api/auth/login", json={
        "username_or_email": "ameen",
        "password": "admin123"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["role"] == "super_admin"
    assert data["username"] == "ameen"
    assert "access_token" in data

def test_admin_signup_and_profile():
    import uuid
    uid = uuid.uuid4().hex[:6]
    test_user = f"arun_{uid}"
    test_email = f"arun_{uid}@testdomain.com"

    # Register new admin
    signup_res = client.post("/api/auth/signup", json={
        "name": "Arun Kumar",
        "email": test_email,
        "password": "SecurePassword123!",
        "phone": "+919876500000",
        "username": test_user
    })
    assert signup_res.status_code == 200
    token_data = signup_res.json()
    assert token_data["role"] == "admin"
    assert token_data["username"] == test_user

    # Fetch public profile
    profile_res = client.get(f"/api/profiles/public/{test_user}")
    assert profile_res.status_code == 200
    pdata = profile_res.json()
    assert pdata["username"] == test_user
    assert pdata["name"] == "Arun Kumar"
    assert pdata["status"] == "ACTIVE"

def test_admin_profile_customization():
    # Login as arun
    login_res = client.post("/api/auth/login", json={
        "username_or_email": "arun",
        "password": "SecurePassword123!"
    })
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Update profile
    update_res = client.put("/api/profiles/me", headers=headers, json={
        "title": "Lead Product Strategist",
        "bio": "10x conversion rate optimization expert.",
        "intro_video": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "heading_text": "Accelerate Your D2C Brand with Arun",
        "theme_settings": {
            "theme": "emerald",
            "button_color": "#059669"
        },
        "social_links": {
            "linkedin": "https://linkedin.com/in/arunkumar"
        }
    })
    assert update_res.status_code == 200

    # Verify public profile reflects updates
    pub_res = client.get("/api/profiles/public/arun")
    assert pub_res.json()["title"] == "Lead Product Strategist"
    assert pub_res.json()["intro_video"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert pub_res.json()["theme_settings"]["button_color"] == "#059669"

def test_super_admin_management_and_disable():
    # Login as Super Admin
    sa_login = client.post("/api/auth/login", json={
        "username_or_email": "ameen",
        "password": "admin123"
    })
    sa_token = sa_login.json()["access_token"]
    sa_headers = {"Authorization": f"Bearer {sa_token}"}

    # List admins
    admins_res = client.get("/api/super-admin/admins", headers=sa_headers)
    assert admins_res.status_code == 200
    admins = admins_res.json()
    assert len(admins) >= 2

    # Find Arun
    arun_admin = next(a for a in admins if a["username"] == "arun")
    arun_id = arun_admin["id"]

    # Temporarily disable Arun
    disable_res = client.put(f"/api/super-admin/admins/{arun_id}/status", headers=sa_headers, json={
        "status": "TEMPORARILY_DISABLED"
    })
    assert disable_res.status_code == 200
    assert disable_res.json()["status"] == "TEMPORARILY_DISABLED"

    # Verify Arun cannot login
    disabled_login = client.post("/api/auth/login", json={
        "username_or_email": "arun",
        "password": "SecurePassword123!"
    })
    assert disabled_login.status_code == 403

    # Verify public profile shows TEMPORARILY_DISABLED
    pub_res = client.get("/api/profiles/public/arun")
    assert pub_res.json()["status"] == "TEMPORARILY_DISABLED"
    assert len(pub_res.json()["sessions"]) == 0

    # Re-enable Arun
    enable_res = client.put(f"/api/super-admin/admins/{arun_id}/status", headers=sa_headers, json={
        "status": "ACTIVE"
    })
    assert enable_res.status_code == 200
    assert enable_res.json()["status"] == "ACTIVE"

def test_slot_lock_double_booking_protection():
    # Fetch Ameen's public profile to get a session
    ameen_pub = client.get("/api/profiles/public/ameen")
    assert ameen_pub.status_code == 200
    session_id = ameen_pub.json()["sessions"][0]["id"]
    admin_id = ameen_pub.json()["id"]

    # Lock slot for Client A
    lock_a = client.post("/api/bookings/hold-slot", json={
        "admin_id": admin_id,
        "session_id": session_id,
        "start_time": "2026-09-15T10:00:00Z",
        "end_time": "2026-09-15T10:15:00Z",
        "session_fingerprint": "client_session_a_xyz"
    })
    assert lock_a.status_code == 200
    lock_id = lock_a.json()["lock_id"]

    # Client B attempts to hold the same slot -> Must return 409 Conflict
    lock_b = client.post("/api/bookings/hold-slot", json={
        "admin_id": admin_id,
        "session_id": session_id,
        "start_time": "2026-09-15T10:00:00Z",
        "end_time": "2026-09-15T10:15:00Z",
        "session_fingerprint": "client_session_b_123"
    })
    assert lock_b.status_code == 409

    # Release hold A
    client.post(f"/api/bookings/release-hold/{lock_id}")
