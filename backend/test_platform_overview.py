"""
Tests for the Super Admin's platform overview: GET /api/super-admin/analytics and
GET /api/super-admin/bookings.

These figures describe the consultants' business, not the Super Admin's. The guarantees:
each admin's bookings and captured payments are attributed to that admin, only captured
money counts, nothing is invented for a booking that was never paid, and a normal admin
cannot read any of it.

Every test builds its own rows and removes them afterwards.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import User, AdminProfile, Booking, Payment

client = TestClient(app)

PASSWORD = "TestPassw0rd!"


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def tracked():
    record = {"user_ids": [], "booking_ids": []}
    yield record
    session = SessionLocal()
    try:
        if record["booking_ids"]:
            session.query(Payment).filter(Payment.booking_id.in_(record["booking_ids"])).delete(synchronize_session=False)
            session.query(Booking).filter(Booking.id.in_(record["booking_ids"])).delete(synchronize_session=False)
        for user_id in record["user_ids"]:
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _user(db, tracked, role, name):
    uid = uuid.uuid4().hex[:8]
    user = User(
        name=f"{name} {uid}",
        email=f"overview_{role}_{uid}@testdomain.com",
        password_hash=get_password_hash(PASSWORD),
        role=role,
        status="ACTIVE",
    )
    db.add(user)
    db.flush()
    db.add(AdminProfile(user_id=user.id, username=f"ov{uid}"))
    db.commit()
    tracked["user_ids"].append(user.id)
    return user


def _headers(user):
    res = client.post("/api/auth/login", json={"username_or_email": user.email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _booking(db, tracked, admin_id, *, amount=None, payment_status=None, client_name="Client"):
    """A booking for `admin_id`, optionally with a payment in the given status."""
    uid = uuid.uuid4().hex
    booking = Booking(
        public_id=f"BMM-OV-{uid[:10]}",
        admin_id=admin_id,
        client_name=client_name,
        client_email=f"client_{uid[:8]}@testdomain.com",
        # Distinct per test: bookings(admin_id, start_time) is uniquely indexed.
        start_time=f"2031-01-01T10:{len(tracked['booking_ids']):02d}:00",
        end_time="2031-01-01T19:00:00",
        status="confirmed" if payment_status == "captured" else "pending_payment",
        payment_status="completed" if payment_status == "captured" else "pending",
        cancellation_token=uid,
    )
    db.add(booking)
    db.flush()
    tracked["booking_ids"].append(booking.id)
    if payment_status:
        db.add(Payment(
            booking_id=booking.id,
            admin_id=admin_id,
            provider="razorpay_simulated" if payment_status == "simulated" else "razorpay",
            order_id=f"order_ov_{uid[:12]}",
            amount=amount,
            currency="INR",
            status=payment_status,
        ))
    db.commit()
    return booking


def _row(analytics, admin_id):
    return next((r for r in analytics["by_admin"] if r["admin_id"] == admin_id), None)


def test_revenue_is_attributed_to_the_admin_who_took_it(db, tracked):
    sa = _user(db, tracked, "super_admin", "Owner")
    a = _user(db, tracked, "admin", "Alpha")
    b = _user(db, tracked, "admin", "Beta")
    _booking(db, tracked, a.id, amount=40000, payment_status="captured")
    _booking(db, tracked, a.id, amount=20000, payment_status="captured")
    _booking(db, tracked, b.id, amount=15000, payment_status="captured")

    res = client.get("/api/super-admin/analytics", headers=_headers(sa))
    assert res.status_code == 200, res.text
    data = res.json()

    row_a, row_b = _row(data, a.id), _row(data, b.id)
    assert row_a == {"admin_id": a.id, "admin_name": a.name, "role": "admin", "bookings": 2, "revenue": 60000}
    assert row_b == {"admin_id": b.id, "admin_name": b.name, "role": "admin", "bookings": 1, "revenue": 15000}
    # The Super Admin took nothing here, so has no row: their console is not their income.
    assert _row(data, sa.id) is None


def test_breakdown_adds_up_to_the_platform_total(db, tracked):
    sa = _user(db, tracked, "super_admin", "Owner")
    a = _user(db, tracked, "admin", "Alpha")
    _booking(db, tracked, a.id, amount=12345, payment_status="captured")

    data = client.get("/api/super-admin/analytics", headers=_headers(sa)).json()
    assert sum(r["revenue"] for r in data["by_admin"]) == data["total_revenue"]
    assert sum(r["bookings"] for r in data["by_admin"]) == data["total_bookings"]


def test_only_captured_payments_count_as_revenue(db, tracked):
    sa = _user(db, tracked, "super_admin", "Owner")
    a = _user(db, tracked, "admin", "Alpha")
    _booking(db, tracked, a.id, amount=50000, payment_status="captured")
    _booking(db, tracked, a.id, amount=70000, payment_status="simulated")
    _booking(db, tracked, a.id, amount=90000, payment_status="created")
    _booking(db, tracked, a.id)

    data = client.get("/api/super-admin/analytics", headers=_headers(sa)).json()
    row = _row(data, a.id)
    assert row["bookings"] == 4
    assert row["revenue"] == 50000


def test_booking_list_names_the_owning_admin_and_only_real_amounts(db, tracked):
    sa = _user(db, tracked, "super_admin", "Owner")
    a = _user(db, tracked, "admin", "Alpha")
    b = _user(db, tracked, "admin", "Beta")
    paid = _booking(db, tracked, a.id, amount=15990, payment_status="captured", client_name="Paid Client")
    sim = _booking(db, tracked, b.id, amount=99900, payment_status="simulated")
    unpaid = _booking(db, tracked, b.id)

    res = client.get("/api/super-admin/bookings", headers=_headers(sa))
    assert res.status_code == 200, res.text
    rows = {r["id"]: r for r in res.json()}

    assert rows[paid.id]["admin_id"] == a.id
    assert rows[paid.id]["admin_name"] == a.name
    assert rows[paid.id]["client_name"] == "Paid Client"
    assert rows[paid.id]["amount"] == 15990
    assert rows[sim.id]["admin_name"] == b.name
    assert rows[sim.id]["amount"] is None
    assert rows[unpaid.id]["amount"] is None


def test_super_admin_own_sessions_are_labelled_as_theirs(db, tracked):
    sa = _user(db, tracked, "super_admin", "Owner")
    _booking(db, tracked, sa.id, amount=30000, payment_status="captured")

    data = client.get("/api/super-admin/analytics", headers=_headers(sa)).json()
    assert _row(data, sa.id)["role"] == "super_admin"


def test_detached_rows_are_reported_as_removed_admins(db, tracked):
    sa = _user(db, tracked, "super_admin", "Owner")
    before = _row(client.get("/api/super-admin/analytics", headers=_headers(sa)).json(), None)
    _booking(db, tracked, None, amount=8000, payment_status="captured")

    after = _row(client.get("/api/super-admin/analytics", headers=_headers(sa)).json(), None)
    assert after["admin_name"] == "Removed admins"
    assert after["revenue"] == (before["revenue"] if before else 0) + 8000


@pytest.mark.parametrize("path", ["/api/super-admin/analytics", "/api/super-admin/bookings"])
def test_a_normal_admin_cannot_read_platform_figures(db, tracked, path):
    a = _user(db, tracked, "admin", "Alpha")
    assert client.get(path, headers=_headers(a)).status_code == 403


@pytest.mark.parametrize("path", ["/api/super-admin/analytics", "/api/super-admin/bookings"])
def test_unauthenticated_caller_is_refused(path):
    assert client.get(path).status_code == 401
