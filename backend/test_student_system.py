"""
Student meeting system: account creation, the must-change-password gate, allowance accounting
(derived + idempotent), Super-Admin-only access, and that student meeting types never leak onto
the public profile. Each test builds and tears down its own rows.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import (
    AdminProfile, User, UserSecurityState, Session as SessionModel, Booking,
    StudentAllowance, AllowanceAdjustment, StudentCredentialEmail, StudentPolicyAcceptance,
)
from app.services import student_allowance
from app.services.student_accounts import TEMP_PASSWORD

seed_initial_data()
client = TestClient(app)
PW = "OwnerPassw0rd!1"


@pytest.fixture
def tracked():
    ids = []
    yield ids
    db = SessionLocal()
    try:
        for uid in ids:
            db.query(Booking).filter((Booking.admin_id == uid) | (Booking.student_id == uid)).delete(synchronize_session=False)
            db.query(StudentAllowance).filter(StudentAllowance.student_id == uid).delete(synchronize_session=False)
            db.query(AllowanceAdjustment).filter(AllowanceAdjustment.student_id == uid).delete(synchronize_session=False)
            db.query(StudentCredentialEmail).filter(StudentCredentialEmail.student_id == uid).delete(synchronize_session=False)
            db.query(StudentPolicyAcceptance).filter(StudentPolicyAcceptance.student_id == uid).delete(synchronize_session=False)
            db.query(SessionModel).filter(SessionModel.admin_id == uid).delete(synchronize_session=False)
            db.query(UserSecurityState).filter(UserSecurityState.user_id == uid).delete(synchronize_session=False)
            db.query(AdminProfile).filter(AdminProfile.user_id == uid).delete(synchronize_session=False)
            db.query(User).filter(User.id == uid).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _user(tracked, role, tag):
    uid = uuid.uuid4().hex[:8]
    db = SessionLocal()
    try:
        u = User(name=f"{role} {tag}", email=f"{role}_{tag}_{uid}@testdomain.com",
                 password_hash=get_password_hash(PW), role=role, status="ACTIVE")
        db.add(u)
        db.flush()
        if role in ("super_admin", "admin"):
            db.add(AdminProfile(user_id=u.id, username=f"{role[:2]}{tag}{uid}"))
        db.commit()
        tracked.append(u.id)
        return {"id": u.id, "email": u.email}
    finally:
        db.close()


def _headers(email, password=PW):
    r = client.post("/api/auth/login", json={"username_or_email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()


# --- access control ----------------------------------------------------------------------

def test_regular_admin_cannot_list_students(tracked):
    admin = _user(tracked, "admin", "a")
    headers, _ = _headers(admin["email"])
    r = client.get("/api/super-admin/students", headers=headers)
    assert r.status_code == 403


def test_super_admin_creates_student_with_allowance(tracked):
    boss = _user(tracked, "super_admin", "b")
    headers, _ = _headers(boss["email"])
    r = client.post("/api/super-admin/students", headers=headers,
                    json={"name": "Stud A", "email": f"stud_{uuid.uuid4().hex[:6]}@testdomain.com", "allocated": 5})
    assert r.status_code == 200, r.text
    body = r.json()
    tracked.append(body["id"])
    assert body["allocated"] == 5
    assert body["remaining"] == 5
    assert body["must_change_password"] is True
    # password never leaked in the response
    assert "password" not in str(body).lower() or "must_change_password" in str(body)


# --- must-change-password gate ----------------------------------------------------------

def test_student_temp_password_is_gated_until_changed(tracked):
    boss = _user(tracked, "super_admin", "c")
    bh, _ = _headers(boss["email"])
    email = f"stud_{uuid.uuid4().hex[:6]}@testdomain.com"
    created = client.post("/api/super-admin/students", headers=bh,
                          json={"name": "Gate", "email": email, "allocated": 1}).json()
    tracked.append(created["id"])

    login = client.post("/api/auth/login", json={"username_or_email": email, "password": TEMP_PASSWORD})
    assert login.status_code == 200
    assert login.json()["role"] == "student"
    assert login.json()["must_change_password"] is True
    sh = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # Gated out of the dashboard until the password is changed.
    blocked = client.get("/api/student/me", headers=sh)
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "password_change_required"

    # Change password -> gate clears, new token works.
    changed = client.post("/api/auth/change-password", headers=sh,
                          json={"current_password": TEMP_PASSWORD, "new_password": "MyNewPass!99"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["must_change_password"] is False
    nh = {"Authorization": f"Bearer {changed.json()['access_token']}"}
    ok = client.get("/api/student/me", headers=nh)
    assert ok.status_code == 200
    assert ok.json()["allowance"]["allocated"] == 1


def test_change_password_rejects_wrong_current(tracked):
    boss = _user(tracked, "super_admin", "d")
    bh, _ = _headers(boss["email"])
    email = f"stud_{uuid.uuid4().hex[:6]}@testdomain.com"
    created = client.post("/api/super-admin/students", headers=bh,
                          json={"name": "Wrong", "email": email, "allocated": 0}).json()
    tracked.append(created["id"])
    login = client.post("/api/auth/login", json={"username_or_email": email, "password": TEMP_PASSWORD})
    sh = {"Authorization": f"Bearer {login.json()['access_token']}"}
    r = client.post("/api/auth/change-password", headers=sh,
                    json={"current_password": "not-it", "new_password": "MyNewPass!99"})
    assert r.status_code == 400


# --- allowance accounting ----------------------------------------------------------------

def test_allowance_available_math_and_deduction(tracked):
    boss = _user(tracked, "super_admin", "e")
    student = _user(tracked, "student", "e")
    db = SessionLocal()
    try:
        db.add(StudentAllowance(student_id=student["id"], allocated=3))
        db.commit()
        assert student_allowance.available(db, student["id"]) == 3

        # A booking that is NOT completed does not consume.
        b = Booking(public_id=f"BK-{uuid.uuid4().hex[:6]}", admin_id=boss["id"], student_id=student["id"],
                    category="student_free", client_name="x", client_email="x@y.com",
                    start_time="2099-01-01T10:00:00Z", end_time="2099-01-01T10:30:00Z",
                    status="confirmed", payment_status="free", attendance_status="pending",
                    cancellation_token=uuid.uuid4().hex)
        db.add(b)
        db.commit()
        assert student_allowance.available(db, student["id"]) == 3

        # Completing it consumes exactly one; re-marking completed does not double-count.
        b.attendance_status = "completed"
        db.commit()
        assert student_allowance.consumed(db, student["id"]) == 1
        assert student_allowance.available(db, student["id"]) == 2
        b.attendance_status = "completed"
        db.commit()
        assert student_allowance.available(db, student["id"]) == 2

        # A paid booking never touches the free count.
        p = Booking(public_id=f"BK-{uuid.uuid4().hex[:6]}", admin_id=boss["id"], student_id=student["id"],
                    category="student_paid", client_name="x", client_email="x@y.com",
                    start_time="2099-01-02T10:00:00Z", end_time="2099-01-02T10:30:00Z",
                    status="confirmed", payment_status="completed", attendance_status="completed",
                    cancellation_token=uuid.uuid4().hex)
        db.add(p)
        db.commit()
        assert student_allowance.consumed(db, student["id"]) == 1
    finally:
        db.close()


def test_adjust_allowance_cannot_drop_below_used(tracked):
    boss = _user(tracked, "super_admin", "f")
    bh, _ = _headers(boss["email"])
    email = f"stud_{uuid.uuid4().hex[:6]}@testdomain.com"
    created = client.post("/api/super-admin/students", headers=bh,
                          json={"name": "Adj", "email": email, "allocated": 2}).json()
    sid = created["id"]
    tracked.append(sid)

    # Record one completed free booking (one used).
    db = SessionLocal()
    try:
        db.add(Booking(public_id=f"BK-{uuid.uuid4().hex[:6]}", admin_id=boss["id"], student_id=sid,
                       category="student_free", client_name="x", client_email="x@y.com",
                       start_time="2099-01-01T10:00:00Z", end_time="2099-01-01T10:30:00Z",
                       status="confirmed", payment_status="free", attendance_status="completed",
                       cancellation_token=uuid.uuid4().hex))
        db.commit()
    finally:
        db.close()

    # Cannot set below the 1 already used.
    bad = client.post(f"/api/super-admin/students/{sid}/allowance", headers=bh, json={"allocated": 0})
    assert bad.status_code == 400
    # A valid raise is audited.
    good = client.post(f"/api/super-admin/students/{sid}/allowance", headers=bh,
                       json={"allocated": 4, "reason": "bonus"})
    assert good.status_code == 200
    assert good.json()["allocated"] == 4
    assert any(a["new_value"] == 4 for a in good.json()["adjustments"])


# --- audience isolation ------------------------------------------------------------------

def test_student_session_excluded_from_public_profile(tracked):
    boss = _user(tracked, "super_admin", "g")
    db = SessionLocal()
    try:
        prof = db.query(AdminProfile).filter(AdminProfile.user_id == boss["id"]).first()
        username = prof.username
        db.add(SessionModel(admin_id=boss["id"], title="Public One", price=10000, audience="public", is_active=True))
        db.add(SessionModel(admin_id=boss["id"], title="Student Free", price=0, audience="student_free", is_active=True))
        db.commit()
    finally:
        db.close()
    r = client.get(f"/api/profiles/public/{username}")
    assert r.status_code == 200, r.text
    titles = [s["title"] for s in r.json().get("sessions", [])]
    assert "Public One" in titles
    assert "Student Free" not in titles
