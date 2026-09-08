"""
Tests for permanent admin deletion (DELETE /api/super-admin/admins/{id}) and the
re-registration block that outlives it.

Every test builds the rows it needs and tears them down afterwards, in the manner of
test_payment_flow.py and test_google_auth.py, so none of these depend on seed state or
leave residue in the shared development database.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import SessionLocal
from app.core.security import get_password_hash, hash_email
from app.models.models import (
    User,
    AdminProfile,
    Session as SessionModel,
    AvailabilityRule,
    AvailabilityException,
    GoogleConnection,
    RazorpayConnection,
    SlotLock,
    Booking,
    Payment,
    Notification,
    DeletedAdminIdentity,
)
from app.services import supabase_auth
from app.api import auth as auth_api

client = TestClient(app)

PASSWORD = "TestPassw0rd!"
VALID_TOKEN = "stub-valid-supabase-token"


# --------------------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------------------

@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def tracked():
    """Collects user ids and email hashes to remove once a test finishes."""
    record = {"user_ids": [], "emails": []}
    yield record

    session = SessionLocal()
    try:
        for user_id in record["user_ids"]:
            session.query(Payment).filter(Payment.admin_id == user_id).delete(synchronize_session=False)
            booking_ids = [
                b.id for b in session.query(Booking).filter(Booking.admin_id == user_id).all()
            ]
            if booking_ids:
                session.query(Payment).filter(Payment.booking_id.in_(booking_ids)).delete(synchronize_session=False)
            session.query(Booking).filter(Booking.admin_id == user_id).delete(synchronize_session=False)
            session.query(Notification).filter(Notification.admin_id == user_id).delete(synchronize_session=False)
            session.query(SlotLock).filter(SlotLock.admin_id == user_id).delete(synchronize_session=False)
            session.query(AvailabilityException).filter(AvailabilityException.admin_id == user_id).delete(synchronize_session=False)
            session.query(AvailabilityRule).filter(AvailabilityRule.admin_id == user_id).delete(synchronize_session=False)
            session.query(GoogleConnection).filter(GoogleConnection.admin_id == user_id).delete(synchronize_session=False)
            session.query(RazorpayConnection).filter(RazorpayConnection.admin_id == user_id).delete(synchronize_session=False)
            session.query(SessionModel).filter(SessionModel.admin_id == user_id).delete(synchronize_session=False)
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        for email in record["emails"]:
            session.query(DeletedAdminIdentity).filter(
                DeletedAdminIdentity.email_hash == hash_email(email)
            ).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _make_user(session, tracked, *, role, suffix, status="ACTIVE"):
    uid = uuid.uuid4().hex[:8]
    email = f"del_{suffix}_{uid}@testdomain.com"
    user = User(
        name=f"Delete Test {suffix}",
        email=email,
        password_hash=get_password_hash(PASSWORD),
        role=role,
        status=status,
    )
    session.add(user)
    session.flush()
    tracked["user_ids"].append(user.id)
    tracked["emails"].append(email)
    return user


@pytest.fixture
def super_admin(db, tracked):
    """A super admin created for this test, plus an authenticated header for it."""
    user = _make_user(db, tracked, role="super_admin", suffix="sa")
    db.add(AdminProfile(user_id=user.id, username=f"sa{uuid.uuid4().hex[:8]}"))
    db.commit()
    res = client.post("/api/auth/login", json={"username_or_email": user.email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"id": user.id, "email": user.email, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture
def full_admin(db, tracked):
    """An admin with one row in every table an admin can own."""
    user = _make_user(db, tracked, role="admin", suffix="admin")
    username = f"tgt{uuid.uuid4().hex[:8]}"
    db.add(AdminProfile(user_id=user.id, username=username, bio="to be erased"))

    session_row = SessionModel(admin_id=user.id, title="Test Session", duration_minutes=30, price=10000)
    db.add(session_row)
    db.flush()

    db.add(AvailabilityRule(admin_id=user.id, day_of_week=1, start_time="09:00", end_time="18:00"))
    db.add(AvailabilityException(admin_id=user.id, exception_date="2030-01-01", is_available=False))
    db.add(GoogleConnection(
        admin_id=user.id,
        google_email=user.email,
        encrypted_refresh_token="ciphertext",
        connection_status="connected",
    ))
    db.add(RazorpayConnection(
        admin_id=user.id,
        key_id="rzp_test_del",
        encrypted_key_secret="ciphertext",
        connection_status="connected",
    ))
    db.add(Notification(admin_id=user.id, type="new_booking", title="t", message="m"))

    from datetime import datetime, timedelta, timezone as tz
    db.add(SlotLock(
        admin_id=user.id,
        session_id=session_row.id,
        start_time="2030-01-01T10:00:00Z",
        end_time="2030-01-01T10:30:00Z",
        locked_by_session="fingerprint",
        expires_at=datetime.now(tz.utc) + timedelta(minutes=5),
    ))

    booking = Booking(
        public_id=f"BK-DEL-{uuid.uuid4().hex[:6].upper()}",
        admin_id=user.id,
        meeting_type_id=session_row.id,
        client_name="Real Client",
        client_email="client@example.com",
        client_phone="+911234567890",
        start_time="2030-01-01T10:00:00Z",
        end_time="2030-01-01T10:30:00Z",
        status="confirmed",
        payment_status="completed",
        google_meet_link="https://meet.google.com/abc-defg-hij",
        google_event_id="evt_123",
        notes="private note",
        cancellation_token=uuid.uuid4().hex,
    )
    db.add(booking)
    db.flush()
    db.add(Payment(
        booking_id=booking.id,
        admin_id=user.id,
        provider="razorpay",
        order_id=f"order_{uuid.uuid4().hex[:10]}",
        amount=10000,
        status="captured",
    ))
    db.commit()
    # ids captured as plain strings: after deletion the ORM objects cannot be refreshed.
    return {
        "id": user.id,
        "username": username,
        "email": user.email,
        "booking_id": booking.id,
    }


@pytest.fixture
def stub_identity(monkeypatch):
    """Replaces Supabase verification with a controllable Google identity."""
    state = {"email": f"gdel_{uuid.uuid4().hex[:8]}@testdomain.com", "name": "Deleted Google User"}

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


def _delete(admin_id, headers, confirm=True):
    return client.delete(
        f"/api/super-admin/admins/{admin_id}?confirm={'true' if confirm else 'false'}",
        headers=headers,
    )


# --------------------------------------------------------------------------------------
# Authorization
# --------------------------------------------------------------------------------------

def test_super_admin_can_permanently_delete_an_admin(db, super_admin, full_admin):
    res = _delete(full_admin["id"], super_admin["headers"])
    assert res.status_code == 200, res.text

    db.expire_all()
    assert db.query(User).filter(User.id == full_admin["id"]).first() is None


def test_deletion_requires_explicit_confirmation(db, super_admin, full_admin):
    res = _delete(full_admin["id"], super_admin["headers"], confirm=False)
    assert res.status_code == 400
    assert db.query(User).filter(User.id == full_admin["id"]).first() is not None


def test_unauthenticated_caller_cannot_delete(db, full_admin):
    res = client.delete(f"/api/super-admin/admins/{full_admin['id']}?confirm=true")
    assert res.status_code == 401
    assert db.query(User).filter(User.id == full_admin["id"]).first() is not None


def test_normal_admin_cannot_delete_another_admin(db, tracked, full_admin):
    other = _make_user(db, tracked, role="admin", suffix="other")
    db.add(AdminProfile(user_id=other.id, username=f"oth{uuid.uuid4().hex[:8]}"))
    db.commit()
    login = client.post("/api/auth/login", json={"username_or_email": other.email, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    res = _delete(full_admin["id"], headers)
    assert res.status_code == 403
    assert db.query(User).filter(User.id == full_admin["id"]).first() is not None


def test_client_role_cannot_delete_an_admin(db, tracked, full_admin):
    customer = _make_user(db, tracked, role="client", suffix="client")
    db.commit()
    login = client.post("/api/auth/login", json={"username_or_email": customer.email, "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    res = _delete(full_admin["id"], headers)
    assert res.status_code == 403
    assert db.query(User).filter(User.id == full_admin["id"]).first() is not None


def test_super_admin_cannot_be_deleted_through_this_endpoint(db, tracked, super_admin):
    victim = _make_user(db, tracked, role="super_admin", suffix="sa2")
    db.commit()

    res = _delete(victim.id, super_admin["headers"])
    assert res.status_code == 403
    assert db.query(User).filter(User.id == victim.id).first() is not None


def test_super_admin_cannot_delete_themselves(db, super_admin):
    res = _delete(super_admin["id"], super_admin["headers"])
    assert res.status_code == 403
    assert db.query(User).filter(User.id == super_admin["id"]).first() is not None


def test_deleting_an_unknown_admin_returns_404(super_admin):
    res = _delete(f"missing-{uuid.uuid4().hex}", super_admin["headers"])
    assert res.status_code == 404


def test_second_delete_is_a_clean_404_not_a_corruption(db, super_admin, full_admin):
    first = _delete(full_admin["id"], super_admin["headers"])
    assert first.status_code == 200
    second = _delete(full_admin["id"], super_admin["headers"])
    assert second.status_code == 404
    # One tombstone, not two.
    assert db.query(DeletedAdminIdentity).filter(
        DeletedAdminIdentity.email_hash == hash_email(full_admin["email"])
    ).count() == 1


# --------------------------------------------------------------------------------------
# What deletion actually removes
# --------------------------------------------------------------------------------------

def test_all_admin_owned_records_are_removed(db, super_admin, full_admin):
    admin_id = full_admin["id"]
    assert _delete(admin_id, super_admin["headers"]).status_code == 200

    db.expire_all()
    assert db.query(AdminProfile).filter(AdminProfile.user_id == admin_id).count() == 0
    assert db.query(SessionModel).filter(SessionModel.admin_id == admin_id).count() == 0
    assert db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == admin_id).count() == 0
    assert db.query(AvailabilityException).filter(AvailabilityException.admin_id == admin_id).count() == 0
    assert db.query(SlotLock).filter(SlotLock.admin_id == admin_id).count() == 0
    assert db.query(Notification).filter(Notification.admin_id == admin_id).count() == 0


def test_google_calendar_credentials_are_removed(db, super_admin, full_admin):
    admin_id = full_admin["id"]
    assert _delete(admin_id, super_admin["headers"]).status_code == 200
    db.expire_all()
    assert db.query(GoogleConnection).filter(GoogleConnection.admin_id == admin_id).count() == 0


def test_payment_credentials_are_removed(db, super_admin, full_admin):
    admin_id = full_admin["id"]
    assert _delete(admin_id, super_admin["headers"]).status_code == 200
    db.expire_all()
    assert db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin_id).count() == 0


def test_bookings_are_anonymized_and_payments_detached(db, super_admin, full_admin):
    admin_id = full_admin["id"]
    booking_id = full_admin["booking_id"]
    assert _delete(admin_id, super_admin["headers"]).status_code == 200

    db.expire_all()
    booking = db.query(Booking).filter(Booking.id == booking_id).first()
    assert booking is not None, "the financial record must survive"
    assert booking.admin_id is None
    assert booking.meeting_type_id is None
    assert booking.client_name == "[deleted]"
    assert booking.client_email == "[deleted]"
    assert booking.client_phone is None
    assert booking.notes is None
    assert booking.google_meet_link is None
    assert booking.status == "cancelled"

    payment = db.query(Payment).filter(Payment.booking_id == booking_id).first()
    assert payment is not None
    assert payment.admin_id is None
    assert payment.amount == 10000


def test_no_orphan_rows_reference_the_deleted_admin(db, super_admin, full_admin):
    admin_id = full_admin["id"]
    assert _delete(admin_id, super_admin["headers"]).status_code == 200

    db.expire_all()
    orphan_counts = {
        "admin_profiles": db.query(AdminProfile).filter(AdminProfile.user_id == admin_id).count(),
        "sessions": db.query(SessionModel).filter(SessionModel.admin_id == admin_id).count(),
        "availability_rules": db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == admin_id).count(),
        "availability_exceptions": db.query(AvailabilityException).filter(AvailabilityException.admin_id == admin_id).count(),
        "google_connections": db.query(GoogleConnection).filter(GoogleConnection.admin_id == admin_id).count(),
        "razorpay_connections": db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin_id).count(),
        "slot_locks": db.query(SlotLock).filter(SlotLock.admin_id == admin_id).count(),
        "notifications": db.query(Notification).filter(Notification.admin_id == admin_id).count(),
        "bookings": db.query(Booking).filter(Booking.admin_id == admin_id).count(),
        "payments": db.query(Payment).filter(Payment.admin_id == admin_id).count(),
    }
    assert orphan_counts == dict.fromkeys(orphan_counts, 0), orphan_counts


def test_failed_deletion_rolls_back_and_removes_nothing(db, monkeypatch, super_admin, full_admin):
    """A failure partway through must leave the account exactly as it was."""
    from app.services import admin_deletion

    admin_id = full_admin["id"]

    # Break the very last step (deleting the user row), so the failure happens *after*
    # bookings were anonymized and every connection row was deleted. Only a real
    # transaction rollback can restore that.
    class NotAMappedClass:
        pass

    monkeypatch.setattr(admin_deletion, "User", NotAMappedClass)

    res = _delete(admin_id, super_admin["headers"])
    assert res.status_code == 500

    monkeypatch.undo()
    db.expire_all()
    assert db.query(User).filter(User.id == admin_id).first() is not None
    assert db.query(AdminProfile).filter(AdminProfile.user_id == admin_id).count() == 1
    assert db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin_id).count() == 1
    assert db.query(GoogleConnection).filter(GoogleConnection.admin_id == admin_id).count() == 1
    booking = db.query(Booking).filter(Booking.id == full_admin["booking_id"]).first()
    assert booking.client_name == "Real Client", "anonymization must have been rolled back too"
    assert db.query(DeletedAdminIdentity).filter(
        DeletedAdminIdentity.email_hash == hash_email(full_admin["email"])
    ).count() == 0


# --------------------------------------------------------------------------------------
# Life after deletion
# --------------------------------------------------------------------------------------

def test_deleted_admin_cannot_log_in(super_admin, full_admin):
    assert _delete(full_admin["id"], super_admin["headers"]).status_code == 200

    res = client.post(
        "/api/auth/login",
        json={"username_or_email": full_admin["email"], "password": PASSWORD},
    )
    assert res.status_code == 401


def test_deleted_admin_public_profile_returns_404(super_admin, full_admin):
    username = full_admin["username"]
    assert client.get(f"/api/profiles/public/{username}").status_code == 200

    assert _delete(full_admin["id"], super_admin["headers"]).status_code == 200

    after = client.get(f"/api/profiles/public/{username}")
    assert after.status_code == 404
    assert "Real Client" not in after.text


def test_deleted_username_can_never_be_claimed_again(super_admin, full_admin):
    username = full_admin["username"]
    assert _delete(full_admin["id"], super_admin["headers"]).status_code == 200

    check = client.get(f"/api/auth/username-available?username={username}")
    assert check.status_code == 200
    assert check.json()["available"] is False


@pytest.mark.parametrize("mutate", [
    lambda e: e,
    lambda e: e.upper(),
    lambda e: f"  {e}  ",
    lambda e: f"\t{e.title()} ",
])
def test_deleted_email_cannot_sign_up_again_in_any_casing(db, super_admin, full_admin, mutate):
    assert _delete(full_admin["id"], super_admin["headers"]).status_code == 200

    res = client.post("/api/auth/signup", json={
        "name": "Trying Again",
        "email": mutate(full_admin["email"]),
        "username": f"again{uuid.uuid4().hex[:8]}",
        "password": PASSWORD,
    })
    assert res.status_code == 403, res.text
    assert "no longer eligible" in res.json()["detail"]

    # Nothing partial was created.
    db.expire_all()
    assert db.query(User).filter(User.email.ilike(full_admin["email"])).first() is None


def test_rejected_signup_creates_no_profile_sessions_or_availability(db, super_admin, full_admin):
    assert _delete(full_admin["id"], super_admin["headers"]).status_code == 200
    username = f"again{uuid.uuid4().hex[:8]}"

    res = client.post("/api/auth/signup", json={
        "name": "Trying Again",
        "email": full_admin["email"].upper(),
        "username": username,
        "password": PASSWORD,
    })
    assert res.status_code == 403

    db.expire_all()
    assert db.query(AdminProfile).filter(AdminProfile.username == username).first() is None
    assert db.query(User).filter(User.email.ilike(full_admin["email"])).first() is None


def test_deleted_email_cannot_register_through_google(db, super_admin, tracked, stub_identity):
    """A Google account whose admin was deleted is refused at both legs."""
    google_email = stub_identity["email"]

    # Build an admin that owns that Google address, then delete it.
    session = SessionLocal()
    try:
        user = User(
            name="Google Admin",
            email=google_email,
            password_hash=get_password_hash(PASSWORD),
            role="admin",
            status="ACTIVE",
        )
        session.add(user)
        session.flush()
        session.add(AdminProfile(user_id=user.id, username=f"g{uuid.uuid4().hex[:8]}"))
        session.commit()
        tracked["user_ids"].append(user.id)
        tracked["emails"].append(google_email)
        admin_id = user.id
    finally:
        session.close()

    assert _delete(admin_id, super_admin["headers"]).status_code == 200

    leg_one = client.post("/api/auth/google", json={"supabase_access_token": VALID_TOKEN})
    assert leg_one.status_code == 403, leg_one.text
    assert "no longer eligible" in leg_one.json()["detail"]

    leg_two = client.post("/api/auth/google/complete", json={
        "supabase_access_token": VALID_TOKEN,
        "username": f"gnew{uuid.uuid4().hex[:8]}",
    })
    assert leg_two.status_code == 403, leg_two.text

    db.expire_all()
    assert db.query(User).filter(User.email.ilike(google_email)).first() is None


def test_tombstone_stores_a_hash_not_the_address(db, super_admin, full_admin):
    email = full_admin["email"]
    assert _delete(full_admin["id"], super_admin["headers"]).status_code == 200

    tombstone = db.query(DeletedAdminIdentity).filter(
        DeletedAdminIdentity.email_hash == hash_email(email)
    ).first()
    assert tombstone is not None
    assert tombstone.deleted_by == super_admin["id"]
    assert tombstone.username == full_admin["username"]
    # The address itself must not be recoverable from the row.
    assert email not in (tombstone.email_hash or "")
    assert len(tombstone.email_hash) == 64


def test_deleted_admin_no_longer_appears_in_the_admin_list(super_admin, full_admin):
    listing = client.get("/api/super-admin/admins", headers=super_admin["headers"])
    assert any(a["id"] == full_admin["id"] for a in listing.json())

    assert _delete(full_admin["id"], super_admin["headers"]).status_code == 200

    after = client.get("/api/super-admin/admins", headers=super_admin["headers"])
    assert all(a["id"] != full_admin["id"] for a in after.json())


# --------------------------------------------------------------------------------------
# Fake/demo data policy
# --------------------------------------------------------------------------------------

def test_startup_seeding_creates_no_demo_admins(db):
    """
    seed_initial_data() must never (re)create sample accounts. Running it again is the
    closest thing to an application restart we can assert on.
    """
    from app.main import seed_initial_data

    before = db.query(User).count()
    seed_initial_data()
    db.expire_all()
    after = db.query(User).count()
    assert after == before, "startup created accounts on a database that already has a super admin"

    demo_emails = [
        "alex@adwaysacademy.com",
        "priya@adwaysacademy.com",
        "david@adwaysacademy.com",
    ]
    for email in demo_emails:
        assert db.query(User).filter(User.email.ilike(email)).first() is None, email


def test_status_endpoint_cannot_fake_a_permanent_deletion(super_admin, full_admin):
    """PERMANENTLY_DELETED is not a settable status: deletion means deletion."""
    res = client.put(
        f"/api/super-admin/admins/{full_admin['id']}/status",
        headers=super_admin["headers"],
        json={"status": "PERMANENTLY_DELETED"},
    )
    assert res.status_code == 400


# =====================================================================================
# Session revocation: an already-issued token must stop working the moment the account goes
# =====================================================================================
#
# A JWT here is signed for seven days and carries only {exp, sub}. It stays cryptographically
# valid long after the account behind it is gone, so nothing about the token itself can
# express "deleted" -- the only thing standing between an old token and the API is the
# per-request database lookup in deps.get_current_user.
#
# That lookup used to answer 404 "User not found" for a deleted account. A 404 does not read
# as "your session is over" to any client, so a revoked admin kept a working-looking dashboard
# that merely threw errors. These assert the contract the frontend now relies on: 401 or 403,
# always carrying X-Auth-Revoked, on every authenticated route.


def _login(email: str) -> str:
    res = client.post("/api/auth/login", json={"username_or_email": email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def test_an_existing_session_dies_the_moment_the_account_is_deleted(super_admin, full_admin):
    """The headline requirement: log in, get deleted, and the token you already hold is dead."""
    token = _login(full_admin["email"])
    headers = {"Authorization": f"Bearer {token}"}

    # The session works before deletion.
    assert client.get("/api/auth/me", headers=headers).status_code == 200

    assert client.delete(
        f"/api/super-admin/admins/{full_admin['id']}?confirm=true", headers=super_admin["headers"]
    ).status_code == 200

    after = client.get("/api/auth/me", headers=headers)
    assert after.status_code == 401, after.text
    assert after.headers.get("X-Auth-Revoked") == "1"


def test_every_device_loses_access_not_just_the_one_that_was_deleted_from(super_admin, full_admin):
    """
    Three separate sign-ins, as three devices would produce. Deletion is not a per-session
    action: an admin must not keep working simply because another browser holds a token.
    """
    sessions = [{"Authorization": f"Bearer {_login(full_admin['email'])}"} for _ in range(3)]
    for headers in sessions:
        assert client.get("/api/auth/me", headers=headers).status_code == 200

    client.delete(
        f"/api/super-admin/admins/{full_admin['id']}?confirm=true", headers=super_admin["headers"]
    )

    for index, headers in enumerate(sessions):
        res = client.get("/api/auth/me", headers=headers)
        assert res.status_code == 401, f"device {index} still had access: {res.text}"
        assert res.headers.get("X-Auth-Revoked") == "1"


@pytest.mark.parametrize("method,path,body", [
    ("get", "/api/profiles/me", None),
    ("put", "/api/profiles/me", {"bio": "written after deletion"}),
    ("get", "/api/sessions/", None),
    ("post", "/api/sessions/", {"title": "x", "duration_minutes": 30, "price": 1000, "currency": "INR"}),
    ("get", "/api/availability/rules", None),
    ("get", "/api/bookings/my-bookings", None),
    ("get", "/api/notifications/", None),
])
def test_no_authenticated_route_answers_a_revoked_token(super_admin, full_admin, method, path, body):
    """
    Reads and writes alike. A revoked account must not be able to change anything -- this is
    the difference between a closed account and one that merely cannot see its dashboard.
    """
    headers = {"Authorization": f"Bearer {_login(full_admin['email'])}"}
    client.delete(
        f"/api/super-admin/admins/{full_admin['id']}?confirm=true", headers=super_admin["headers"]
    )

    call = getattr(client, method)
    res = call(path, headers=headers) if body is None else call(path, headers=headers, json=body)
    assert res.status_code in (401, 403), f"{method.upper()} {path} answered {res.status_code}"
    assert res.headers.get("X-Auth-Revoked") == "1"


def test_a_write_in_flight_when_the_account_is_deleted_does_not_land(db, super_admin, full_admin):
    """
    The race the requirement names: the admin submits an edit at about the moment the Super
    Admin deletes them. The write must not take effect, and the database must stay consistent.
    """
    headers = {"Authorization": f"Bearer {_login(full_admin['email'])}"}
    client.delete(
        f"/api/super-admin/admins/{full_admin['id']}?confirm=true", headers=super_admin["headers"]
    )

    res = client.put("/api/profiles/me", headers=headers, json={"bio": "should never be stored"})
    assert res.status_code in (401, 403)

    db.expire_all()
    assert db.query(AdminProfile).filter(AdminProfile.user_id == full_admin["id"]).first() is None
    assert db.query(User).filter(User.id == full_admin["id"]).first() is None


def test_a_disabled_account_is_revoked_too_but_its_data_survives(db, super_admin, full_admin):
    """
    Suspension is not deletion. Access stops immediately and carries the same marker, but the
    profile, sessions and username all remain so re-enabling restores the account intact.
    """
    headers = {"Authorization": f"Bearer {_login(full_admin['email'])}"}
    assert client.put(
        f"/api/super-admin/admins/{full_admin['id']}/status",
        headers=super_admin["headers"],
        json={"status": "TEMPORARILY_DISABLED"},
    ).status_code == 200

    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 403
    assert res.headers.get("X-Auth-Revoked") == "1"

    db.expire_all()
    assert db.query(User).filter(User.id == full_admin["id"]).first() is not None
    assert db.query(AdminProfile).filter(AdminProfile.user_id == full_admin["id"]).first() is not None


def test_re_enabling_a_disabled_admin_restores_access_with_the_same_username(db, super_admin, full_admin):
    headers = {"Authorization": f"Bearer {_login(full_admin['email'])}"}
    before = db.query(AdminProfile).filter(AdminProfile.user_id == full_admin["id"]).one().username

    for new_status in ("TEMPORARILY_DISABLED", "ACTIVE"):
        client.put(
            f"/api/super-admin/admins/{full_admin['id']}/status",
            headers=super_admin["headers"],
            json={"status": new_status},
        )

    assert client.get("/api/auth/me", headers=headers).status_code == 200
    db.expire_all()
    assert db.query(AdminProfile).filter(AdminProfile.user_id == full_admin["id"]).one().username == before


def test_an_ordinary_permission_denial_does_not_revoke_the_session(db, tracked, full_admin):
    """
    The counter-case, and the reason the marker exists at all.

    A staff admin calling a super-admin endpoint is legitimately signed in and simply lacks
    the privilege. That is also a 403, and if it carried the revocation marker the client
    would sign them out for clicking the wrong thing.
    """
    headers = {"Authorization": f"Bearer {_login(full_admin['email'])}"}
    res = client.get("/api/super-admin/admins", headers=headers)
    assert res.status_code == 403
    assert res.headers.get("X-Auth-Revoked") is None, "a role denial must not end the session"

    # And the session still works for what it is entitled to.
    assert client.get("/api/auth/me", headers=headers).status_code == 200



# NOTE: reconcile_database_schema() in app/main.py drops notifications, payments, bookings,
# availability_exceptions and availability_rules when it detects a legacy Supabase schema, and
# it runs on every startup. Two of those tables are the financial record that
# permanently_delete_admin() deliberately keeps and anonymizes rather than deleting.
#
# A guard was added here that refused to drop a populated table, and it was withdrawn at the
# owner's request -- that function is to stay exactly as written. Recording the reasoning so
# the next person does not have to rediscover it:
#
#   Both trigger conditions were false in production when checked on 2026-09-08
#   (availability_rules.admin_id is character varying, no FK to a legacy `profiles` table), and
#   bookings and payments were both empty, so nothing has been lost. The path is dormant
#   rather than safe: changing admin_id to a native uuid, or reintroducing that FK, arms it.
