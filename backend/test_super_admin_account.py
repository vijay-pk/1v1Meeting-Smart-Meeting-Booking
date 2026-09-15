"""
Tests for the Super Admin's own account settings (api/super_admin_settings.py).

A throwaway super_admin user is created per test, so the real seeded Super Admin is never
touched. Every rule that protects the account is asserted here: who may call it, what needs
the current password, uniqueness, and that a password change ends older sessions.
"""
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.core.database import SessionLocal
from app.core.security import get_password_hash, verify_password
from app.models.models import AdminProfile, User, UserSecurityState

seed_initial_data()
client = TestClient(app)
PASSWORD = "OldPassw0rd!123"


@pytest.fixture
def tracked():
    ids = []
    yield ids
    session = SessionLocal()
    try:
        for user_id in ids:
            session.query(UserSecurityState).filter(UserSecurityState.user_id == user_id).delete(synchronize_session=False)
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _user(tracked, role="super_admin", tag="s"):
    uid = uuid.uuid4().hex[:8]
    db = SessionLocal()
    try:
        user = User(name=f"Owner {tag}", email=f"sa_{tag}_{uid}@testdomain.com",
                    password_hash=get_password_hash(PASSWORD), role=role, status="ACTIVE")
        db.add(user)
        db.flush()
        db.add(AdminProfile(user_id=user.id, username=f"sa{tag}{uid}"))
        db.commit()
        tracked.append(user.id)
        return {"id": user.id, "email": user.email, "username": f"sa{tag}{uid}"}
    finally:
        db.close()


def _login(identifier, password=PASSWORD):
    return client.post("/api/auth/login", json={"username_or_email": identifier, "password": password})


def _headers(account, password=PASSWORD):
    res = _login(account["email"], password)
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
def boss(tracked):
    return _user(tracked)


# --- access ------------------------------------------------------------------------------

def test_anonymous_is_refused():
    assert client.get("/api/super-admin/account").status_code == 401
    assert client.put("/api/super-admin/account", json={"name": "x"}).status_code == 401
    assert client.post("/api/super-admin/account/password", json={
        "current_password": "a", "new_password": "b", "confirm_password": "b"}).status_code == 401


def test_admin_cannot_use_super_admin_account_settings(tracked):
    admin = _user(tracked, role="admin", tag="a")
    h = _headers(admin)
    assert client.get("/api/super-admin/account", headers=h).status_code == 403
    assert client.put("/api/super-admin/account", headers=h, json={"name": "Hacker"}).status_code == 403
    assert client.post("/api/super-admin/account/password", headers=h, json={
        "current_password": PASSWORD, "new_password": "NewPassw0rd!9", "confirm_password": "NewPassw0rd!9"}).status_code == 403


def test_account_payload_has_no_secrets(boss):
    body = client.get("/api/super-admin/account", headers=_headers(boss)).json()
    assert set(body) == {"id", "name", "username", "email", "role"}


# --- name / username / email -------------------------------------------------------------

def test_change_name_without_password(boss):
    res = client.put("/api/super-admin/account", headers=_headers(boss), json={"name": "  New Owner  "})
    assert res.status_code == 200 and res.json()["name"] == "New Owner"


def test_empty_name_is_rejected(boss):
    assert client.put("/api/super-admin/account", headers=_headers(boss), json={"name": "   "}).status_code == 400


def test_change_username_requires_current_password(boss):
    h = _headers(boss)
    new = f"owner{uuid.uuid4().hex[:6]}"
    assert client.put("/api/super-admin/account", headers=h, json={"username": new}).status_code == 400
    assert client.put("/api/super-admin/account", headers=h, json={"username": new, "current_password": "wrong"}).status_code == 400
    res = client.put("/api/super-admin/account", headers=h, json={"username": new, "current_password": PASSWORD})
    assert res.status_code == 200 and res.json()["username"] == new
    assert _login(new).status_code == 200, "the new username signs in"
    assert client.get(f"/api/profiles/public/{new}").status_code == 200


def test_invalid_reserved_and_duplicate_usernames_are_rejected(tracked, boss):
    other = _user(tracked, role="admin", tag="o")
    h = _headers(boss)
    for bad in ("ab", "Has Space", "admin", other["username"]):
        res = client.put("/api/super-admin/account", headers=h, json={"username": bad, "current_password": PASSWORD})
        assert res.status_code == 400, bad
    # The other admin's page still belongs to them.
    assert client.get(f"/api/profiles/public/{other['username']}").json()["id"] == other["id"]


def test_same_username_is_a_no_op_not_a_duplicate(boss):
    res = client.put("/api/super-admin/account", headers=_headers(boss), json={"username": boss["username"]})
    assert res.status_code == 200


def test_change_email(boss):
    h = _headers(boss)
    new = f"Owner.New_{uuid.uuid4().hex[:6]}@TestDomain.com"
    assert client.put("/api/super-admin/account", headers=h, json={"email": new}).status_code == 400
    res = client.put("/api/super-admin/account", headers=h, json={"email": new, "current_password": PASSWORD})
    assert res.status_code == 200 and res.json()["email"] == new.lower()
    assert _login(new.lower()).status_code == 200
    assert _login(boss["email"]).status_code == 401


def test_duplicate_and_malformed_email_are_rejected(tracked, boss):
    other = _user(tracked, role="admin", tag="o")
    h = _headers(boss)
    assert client.put("/api/super-admin/account", headers=h, json={"email": other["email"].upper(), "current_password": PASSWORD}).status_code == 400
    assert client.put("/api/super-admin/account", headers=h, json={"email": "not-an-email", "current_password": PASSWORD}).status_code == 422


def test_failed_change_changes_nothing(tracked, boss):
    other = _user(tracked, role="admin", tag="o")
    h = _headers(boss)
    res = client.put("/api/super-admin/account", headers=h, json={
        "name": "Should Not Save", "email": other["email"], "current_password": PASSWORD})
    assert res.status_code == 400
    assert client.get("/api/super-admin/account", headers=h).json()["name"] != "Should Not Save"


# --- password ----------------------------------------------------------------------------

def _change(h, current=PASSWORD, new="NewPassw0rd!9", confirm=None):
    return client.post("/api/super-admin/account/password", headers=h, json={
        "current_password": current, "new_password": new, "confirm_password": new if confirm is None else confirm})


def test_wrong_current_password_fails(boss):
    assert _change(_headers(boss), current="nope").status_code == 400


def test_mismatched_confirmation_fails(boss):
    assert _change(_headers(boss), confirm="Different1!").status_code == 400


def test_short_password_fails(boss):
    assert _change(_headers(boss), new="short1").status_code == 400


def test_password_change_hashes_signs_out_old_sessions_and_keeps_this_one(boss):
    old_headers = _headers(boss)
    other_device = _headers(boss)
    time.sleep(1.1)  # tokens carry whole-second iat; the change must land in a later second

    res = _change(old_headers)
    assert res.status_code == 200, res.text
    fresh = {"Authorization": f"Bearer {res.json()['access_token']}"}

    db = SessionLocal()
    try:
        stored = db.query(User).filter(User.id == boss["id"]).one().password_hash
        assert stored != "NewPassw0rd!9" and verify_password("NewPassw0rd!9", stored)
    finally:
        db.close()

    revoked = client.get("/api/super-admin/account", headers=other_device)
    assert revoked.status_code == 401 and revoked.headers.get("X-Auth-Revoked") == "1"
    assert client.get("/api/super-admin/account", headers=fresh).status_code == 200

    assert _login(boss["email"], PASSWORD).status_code == 401
    assert _login(boss["email"], "NewPassw0rd!9").status_code == 200
    assert "password" not in res.text.lower().replace("password changed", "")
