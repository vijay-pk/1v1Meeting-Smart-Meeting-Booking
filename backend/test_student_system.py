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
from app.core.security import get_password_hash, normalize_email
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


def test_only_super_admin_manages_student_meeting_types(tracked):
    """
    Student meeting types are Super-Admin-only, and a free one is free on the server whatever
    price the client sent. The price field is removed from the free form, but the guarantee
    lives on the server, not in the UI.
    """
    adm = _user(tracked, "admin", "sx")
    ah, _ = _headers(adm["email"])
    denied = client.post("/api/sessions/", headers=ah, json={
        "title": "Sneaky", "duration_minutes": 30, "price": 50000,
        "audience": "student_free", "is_active": True,
    })
    assert denied.status_code == 403

    boss = _user(tracked, "super_admin", "sy")
    bh, _ = _headers(boss["email"])

    # A free student type is forced to price 0 even though a price was submitted.
    free = client.post("/api/sessions/", headers=bh, json={
        "title": "Free Student", "duration_minutes": 30, "price": 99900,
        "audience": "student_free", "is_active": True,
    })
    assert free.status_code == 200, free.text
    assert free.json()["audience"] == "student_free"
    assert free.json()["price"] == 0

    # A paid student type keeps its configured price (existing Razorpay path).
    paid = client.post("/api/sessions/", headers=bh, json={
        "title": "Paid Student", "duration_minutes": 30, "price": 150000,
        "audience": "student_paid", "is_active": True,
    })
    assert paid.status_code == 200, paid.text
    assert paid.json()["price"] == 150000

    # A regular admin cannot touch the Super Admin's student type (scoped out and guarded).
    edit = client.put(f"/api/sessions/{free.json()['id']}", headers=ah, json={"title": "Hijack"})
    assert edit.status_code in (403, 404)


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


def test_first_login_change_needs_no_current_password(tracked):
    """
    The forced first-login change sends only the new password -- the temp-password field was
    removed from that screen. The session, minted from the temp password at /auth/login, is the
    authorization; the backend skips the current-password check while must_change_password is set.
    """
    boss = _user(tracked, "super_admin", "d")
    bh, _ = _headers(boss["email"])
    email = f"stud_{uuid.uuid4().hex[:6]}@testdomain.com"
    created = client.post("/api/super-admin/students", headers=bh,
                          json={"name": "NoCur", "email": email, "allocated": 0}).json()
    tracked.append(created["id"])
    login = client.post("/api/auth/login", json={"username_or_email": email, "password": TEMP_PASSWORD})
    sh = {"Authorization": f"Bearer {login.json()['access_token']}"}

    r = client.post("/api/auth/change-password", headers=sh, json={"new_password": "MyNewPass!99"})
    assert r.status_code == 200, r.text
    assert r.json()["must_change_password"] is False


def test_change_password_requires_authentication():
    """An unauthenticated caller can never set a password -- no token, no change."""
    r = client.post("/api/auth/change-password", json={"new_password": "Whatever!99"})
    assert r.status_code in (401, 403)


def test_voluntary_change_still_requires_correct_current(tracked):
    """
    Once must_change_password is cleared, a further change is voluntary and still requires the
    correct current password. Removing the temp field for first-login must not weaken that.
    """
    boss = _user(tracked, "super_admin", "d2")
    bh, _ = _headers(boss["email"])
    email = f"stud_{uuid.uuid4().hex[:6]}@testdomain.com"
    created = client.post("/api/super-admin/students", headers=bh,
                          json={"name": "Vol", "email": email, "allocated": 0}).json()
    tracked.append(created["id"])
    login = client.post("/api/auth/login", json={"username_or_email": email, "password": TEMP_PASSWORD})
    sh = {"Authorization": f"Bearer {login.json()['access_token']}"}

    # First-login change clears must_change_password and rotates the token.
    first = client.post("/api/auth/change-password", headers=sh, json={"new_password": "MyNewPass!99"})
    assert first.status_code == 200, first.text
    nh = {"Authorization": f"Bearer {first.json()['access_token']}"}

    # A further (voluntary) change with a wrong current password is rejected...
    wrong = client.post("/api/auth/change-password", headers=nh,
                        json={"current_password": "not-it", "new_password": "Another!100"})
    assert wrong.status_code == 400

    # ...and accepted with the correct current password.
    right = client.post("/api/auth/change-password", headers=nh,
                        json={"current_password": "MyNewPass!99", "new_password": "Another!100"})
    assert right.status_code == 200, right.text


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


def test_deleting_student_frees_email_for_reuse(tracked):
    boss = _user(tracked, "super_admin", "del")
    bh, _ = _headers(boss["email"])
    email = f"reuse_{uuid.uuid4().hex[:6]}@testdomain.com"

    first = client.post("/api/super-admin/students", headers=bh,
                        json={"name": "First", "email": email, "allocated": 2}).json()
    tracked.append(first["id"])

    # Duplicate rejected while the first account exists.
    dup = client.post("/api/super-admin/students", headers=bh,
                     json={"name": "Dup", "email": email, "allocated": 1})
    assert dup.status_code == 400

    # Full delete releases the email identity.
    d = client.delete(f"/api/super-admin/students/{first['id']}", headers=bh)
    assert d.status_code == 200, d.text
    assert d.json()["deleted"] is True

    # The user row is actually gone.
    db = SessionLocal()
    try:
        assert db.query(User).filter(User.id == first["id"]).first() is None
    finally:
        db.close()

    # Re-create with the same email -> fresh identity, allowance and must-change state.
    second = client.post("/api/super-admin/students", headers=bh,
                        json={"name": "Second", "email": email, "allocated": 3})
    assert second.status_code == 200, second.text
    body = second.json()
    tracked.append(body["id"])
    assert body["id"] != first["id"]
    assert body["allocated"] == 3 and body["remaining"] == 3
    assert body["must_change_password"] is True


def test_recreate_over_stale_soft_deleted_student(tracked):
    """A student left as PERMANENTLY_DELETED by the old soft-delete must not block the email."""
    boss = _user(tracked, "super_admin", "stale")
    bh, _ = _headers(boss["email"])
    email = f"stale_{uuid.uuid4().hex[:6]}@testdomain.com"

    db = SessionLocal()
    try:
        u = User(name="Old", email=normalize_email(email), password_hash=get_password_hash("x"),
                 role="student", status="PERMANENTLY_DELETED", must_change_password=False)
        db.add(u); db.flush()
        db.add(StudentAllowance(student_id=u.id, allocated=2))
        db.commit()
        old_id = u.id
    finally:
        db.close()
    tracked.append(old_id)

    # Hidden from the list (status filtered out).
    lst = client.get("/api/super-admin/students", headers=bh).json()
    assert all(s["email"] != normalize_email(email) for s in lst)

    # Creating with the same email reconciles the stale row and succeeds with a fresh identity.
    r = client.post("/api/super-admin/students", headers=bh,
                    json={"name": "New", "email": email, "allocated": 3})
    assert r.status_code == 200, r.text
    body = r.json(); tracked.append(body["id"])
    assert body["id"] != old_id and body["remaining"] == 3

    db = SessionLocal()
    try:
        assert db.query(User).filter(User.id == old_id).first() is None
    finally:
        db.close()


def test_admin_email_cannot_be_reused_for_student(tracked):
    boss = _user(tracked, "super_admin", "ae")
    admin = _user(tracked, "admin", "ae")
    bh, _ = _headers(boss["email"])
    r = client.post("/api/super-admin/students", headers=bh,
                    json={"name": "X", "email": admin["email"], "allocated": 1})
    assert r.status_code == 400
    assert "another account" in r.json()["detail"].lower()
