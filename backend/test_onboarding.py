"""
Tests for first-time setup status: GET /api/profiles/me/onboarding.

The dashboard checklist used to decide completion in the browser -- "Working Hours"
hardcoded done, "Connect Gateway" hardcoded not done, and the other two read from an auth
store nothing populated -- so an admin who had finished three steps was told "1 of 4". The
backend now derives every step from persisted rows, scoped to the signed-in admin.

Every test builds and tears down its own rows, so the suite is order-independent.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.core.database import SessionLocal
from app.models.models import (
    AdminOnboarding,
    AdminProfile,
    AvailabilityRule,
    RazorpayConnection,
    Session as SessionModel,
    User,
)

seed_initial_data()
client = TestClient(app)

PASSWORD = "TestPassw0rd!123"
PHOTO = "https://example.supabase.co/storage/v1/object/public/profile-media/p.png"


@pytest.fixture
def tracked():
    ids = []
    yield ids
    session = SessionLocal()
    try:
        for user_id in ids:
            for model in (RazorpayConnection, AvailabilityRule, SessionModel, AdminOnboarding):
                session.query(model).filter(model.admin_id == user_id).delete(synchronize_session=False)
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _make_admin(tracked, tag="a"):
    uid = uuid.uuid4().hex[:8]
    email = f"onb_{tag}_{uid}@testdomain.com"
    username = f"onb{tag}{uid}"
    res = client.post("/api/auth/signup", json={
        "name": f"Onboarding {tag}", "email": email, "password": PASSWORD, "username": username,
    })
    assert res.status_code == 200, res.text
    data = res.json()
    tracked.append(data["user_id"])
    return {
        "id": data["user_id"],
        "email": email,
        "username": username,
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
    }


@pytest.fixture
def admin(tracked):
    return _make_admin(tracked, "a")


def _status(headers):
    res = client.get("/api/profiles/me/onboarding", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def _login(admin):
    res = client.post("/api/auth/login", json={
        "username_or_email": admin["email"], "password": PASSWORD,
    })
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _save_photo(admin):
    res = client.put("/api/profiles/me", headers=admin["headers"], json={"profile_photo": PHOTO})
    assert res.status_code == 200, res.text


def _create_session(admin, **overrides):
    body = {
        "title": "Intro call", "description": "", "duration_minutes": 30,
        "price": 49900, "currency": "INR", "is_active": True, **overrides,
    }
    res = client.post("/api/sessions/", headers=admin["headers"], json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _connect_razorpay(admin):
    res = client.post("/api/payments/admin/setup", headers=admin["headers"], json={
        "key_id": "rzp_live_onboard123", "key_secret": "onboardsecret1234567890",
        "account_reference": admin["username"],
    })
    assert res.status_code == 200, res.text


def _complete_everything(admin):
    _save_photo(admin)
    _create_session(admin)
    _connect_razorpay(admin)


# ---------------------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------------------

def test_requires_authentication():
    assert client.get("/api/profiles/me/onboarding").status_code == 401


# ---------------------------------------------------------------------------------------
# A brand-new admin
# ---------------------------------------------------------------------------------------

def test_signup_seeds_no_sessions_and_no_prices(admin):
    assert client.get("/api/sessions/", headers=admin["headers"]).json() == []
    public = client.get(f"/api/profiles/public/{admin['username']}").json()
    assert public["sessions"] == []


def test_new_admin_has_not_completed_setup(admin):
    body = _status(admin["headers"])
    assert body["profile"] is False          # no photo yet
    assert body["meeting_type"] is False     # nothing seeded
    assert body["gateway"] is False
    # Signup provides Mon-Fri 09:00-18:00, which the admin can change during setup.
    assert body["working_hours"] is True
    assert body["completed_count"] == 1
    assert body["total_count"] == 4
    assert body["setup_completed"] is False
    assert body["username"] == admin["username"]


# ---------------------------------------------------------------------------------------
# Each step, from persisted rows
# ---------------------------------------------------------------------------------------

def test_profile_step_needs_a_saved_photo(admin):
    assert _status(admin["headers"])["profile"] is False
    _save_photo(admin)
    assert _status(admin["headers"])["profile"] is True


def test_profile_step_is_not_done_after_the_photo_is_cleared(admin):
    _save_photo(admin)
    client.put("/api/profiles/me", headers=admin["headers"], json={"profile_photo": ""})
    assert _status(admin["headers"])["profile"] is False


def test_an_inactive_session_does_not_count(admin):
    _create_session(admin, is_active=False)
    assert _status(admin["headers"])["meeting_type"] is False


def test_an_active_session_counts(admin):
    _create_session(admin)
    assert _status(admin["headers"])["meeting_type"] is True


def test_a_free_active_session_counts(admin):
    _create_session(admin, price=0)
    assert _status(admin["headers"])["meeting_type"] is True


def test_a_deleted_session_does_not_count(admin):
    created = _create_session(admin)
    assert client.delete(f"/api/sessions/{created['id']}", headers=admin["headers"]).status_code == 200
    assert _status(admin["headers"])["meeting_type"] is False


def test_working_hours_follow_the_saved_rules(admin):
    res = client.post("/api/availability/rules", headers=admin["headers"], json={"rules": []})
    assert res.status_code == 200, res.text
    assert _status(admin["headers"])["working_hours"] is False

    res = client.post("/api/availability/rules", headers=admin["headers"], json={"rules": [
        {"day_of_week": 2, "start_time": "10:00", "end_time": "13:00", "is_active": True},
    ]})
    assert res.status_code == 200, res.text
    assert _status(admin["headers"])["working_hours"] is True


def test_only_inactive_working_hours_do_not_count(admin):
    client.post("/api/availability/rules", headers=admin["headers"], json={"rules": [
        {"day_of_week": 2, "start_time": "10:00", "end_time": "13:00", "is_active": False},
    ]})
    assert _status(admin["headers"])["working_hours"] is False


def test_gateway_step_follows_this_admins_razorpay_connection(admin):
    assert _status(admin["headers"])["gateway"] is False
    _connect_razorpay(admin)
    assert _status(admin["headers"])["gateway"] is True
    client.post("/api/payments/admin/disconnect", headers=admin["headers"])
    assert _status(admin["headers"])["gateway"] is False


# ---------------------------------------------------------------------------------------
# Completion
# ---------------------------------------------------------------------------------------

def test_all_four_steps_complete_setup(admin):
    _complete_everything(admin)
    body = _status(admin["headers"])
    assert (body["profile"], body["working_hours"], body["meeting_type"], body["gateway"]) == (
        True, True, True, True
    )
    assert body["completed_count"] == 4
    assert body["setup_completed"] is True
    assert body["setup_completed_at"]


def test_three_of_four_does_not_complete_setup(admin):
    _save_photo(admin)
    _create_session(admin)
    body = _status(admin["headers"])
    assert body["completed_count"] == 3
    assert body["setup_completed"] is False


def test_status_survives_logout_and_login(admin):
    _save_photo(admin)
    _create_session(admin)
    before = _status(admin["headers"])
    after = _status(_login(admin))
    assert before == after


def test_completed_setup_is_not_undone_by_a_later_disconnect(admin):
    _complete_everything(admin)
    assert _status(admin["headers"])["setup_completed"] is True

    client.post("/api/payments/admin/disconnect", headers=admin["headers"])
    body = _status(admin["headers"])
    # The checklist reports the truth...
    assert body["gateway"] is False
    assert body["completed_count"] == 3
    # ...but an established admin is not sent back through first-time setup.
    assert body["setup_completed"] is True


def test_completion_is_recorded_once(admin, tracked):
    _complete_everything(admin)
    _status(admin["headers"])
    _status(admin["headers"])
    session = SessionLocal()
    try:
        assert session.query(AdminOnboarding).filter(AdminOnboarding.admin_id == admin["id"]).count() == 1
    finally:
        session.close()


def test_reading_status_changes_nothing_else(admin):
    _save_photo(admin)
    profile_before = client.get("/api/profiles/me", headers=admin["headers"]).json()
    sessions_before = client.get("/api/sessions/", headers=admin["headers"]).json()
    _status(admin["headers"])
    assert client.get("/api/profiles/me", headers=admin["headers"]).json() == profile_before
    assert client.get("/api/sessions/", headers=admin["headers"]).json() == sessions_before


# ---------------------------------------------------------------------------------------
# Multi-admin isolation
# ---------------------------------------------------------------------------------------

def test_each_admin_has_their_own_status(tracked):
    a = _make_admin(tracked, "a")
    b = _make_admin(tracked, "b")
    _complete_everything(a)
    _save_photo(b)

    status_a = _status(a["headers"])
    status_b = _status(b["headers"])
    assert status_a["completed_count"] == 4 and status_a["setup_completed"] is True
    assert (status_b["profile"], status_b["meeting_type"], status_b["gateway"]) == (True, False, False)
    assert status_b["setup_completed"] is False
    assert status_a["username"] == a["username"]
    assert status_b["username"] == b["username"]


# ---------------------------------------------------------------------------------------
# The public link does not depend on the admin being signed in
# ---------------------------------------------------------------------------------------

def test_public_profile_needs_no_authentication_before_or_after_login(admin):
    _complete_everything(admin)
    username = _status(admin["headers"])["username"]

    anonymous = client.get(f"/api/profiles/public/{username}")
    assert anonymous.status_code == 200
    assert anonymous.json()["id"] == admin["id"]
    assert len(anonymous.json()["sessions"]) == 1

    # A fresh login issues a new token; the public page is unaffected either way.
    _login(admin)
    again = client.get(f"/api/profiles/public/{username}")
    assert again.status_code == 200 and again.json()["id"] == admin["id"]
