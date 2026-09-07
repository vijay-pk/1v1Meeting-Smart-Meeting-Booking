"""
Tests for the Admin Bookings section.

The bug these cover: a client completed a real, verified payment, the booking landed in the
database, and the admin's Bookings page still showed nothing. The page was querying Supabase
while the booking flow wrote to this database — so the assertions here follow the whole chain,
payment -> database -> API, rather than any single layer.
"""
import hashlib
import hmac
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.core.database import SessionLocal
from app.core.security import encrypt_secret
from app.models.models import (
    User,
    AdminProfile,
    Session as SessionModel,
    AvailabilityRule,
    Booking,
    Payment,
    RazorpayConnection,
)
from app.api import payments as payments_api

seed_initial_data()
client = TestClient(app)

PASSWORD = "TestPassw0rd!123"
ADMIN_SECRET = "adminsecret1234567890"


@pytest.fixture(autouse=True)
def stub_gateway(monkeypatch):
    """
    Stubs only the outbound call to Razorpay. Signature verification stays real, so these
    tests still prove a booking is confirmed by a correctly signed payment and nothing else.
    """
    async def fake_order(**kwargs):
        return {
            "id": f"order_{uuid.uuid4().hex[:14]}",
            "amount": kwargs.get("amount_in_paise", 0),
            "currency": kwargs.get("currency", "INR"),
            "simulated": False,
        }

    monkeypatch.setattr(payments_api, "create_razorpay_order", fake_order)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def tracked():
    ids = []
    yield ids

    session = SessionLocal()
    try:
        for user_id in ids:
            booking_ids = [
                b.id for b in session.query(Booking).filter(Booking.admin_id == user_id).all()
            ]
            if booking_ids:
                session.query(Payment).filter(
                    Payment.booking_id.in_(booking_ids)
                ).delete(synchronize_session=False)
            for model in (Booking, RazorpayConnection, AvailabilityRule, SessionModel):
                session.query(model).filter(model.admin_id == user_id).delete(synchronize_session=False)
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _make_admin(tracked, tag="a"):
    uid = uuid.uuid4().hex[:8]
    email = f"bk_{tag}_{uid}@testdomain.com"
    username = f"bk{tag}{uid}"
    res = client.post("/api/auth/signup", json={
        "name": f"Bookings {tag}", "email": email, "password": PASSWORD, "username": username,
    })
    assert res.status_code == 200, res.text
    data = res.json()
    tracked.append(data["user_id"])

    session = SessionLocal()
    try:
        session.add(RazorpayConnection(
            admin_id=data["user_id"],
            key_id=f"rzp_test_{tag}{uid}",
            encrypted_key_secret=encrypt_secret(ADMIN_SECRET),
            connection_status="connected",
        ))
        session.commit()
    finally:
        session.close()

    headers = {"Authorization": f"Bearer {data['access_token']}"}
    # Signup deliberately seeds no sessions and no prices, so each test creates its own.
    created = client.post("/api/sessions/", headers=headers, json={
        "title": "Test Consultation", "description": "", "duration_minutes": 30,
        "price": 99900, "currency": "INR", "is_active": True,
    })
    assert created.status_code == 200, created.text

    return {
        "id": data["user_id"],
        "email": email,
        "headers": headers,
        "session_id": created.json()["id"],
    }


@pytest.fixture
def admin(tracked):
    return _make_admin(tracked, "a")


def _hold(admin, date_str="2030-08-05", fingerprint=None):
    """
    Takes the slot hold that create-order now consumes.

    The real checkout page has always called hold-slot before create-order; the backend just
    never checked, so lock_id was accepted and ignored. These tests skipped the hold, which
    is why they exercised a path no client actually takes.
    """
    res = client.post("/api/bookings/hold-slot", json={
        "admin_id": admin["id"],
        "session_id": admin["session_id"],
        "start_time": f"{date_str}T10:00:00Z",
        "end_time": f"{date_str}T10:30:00Z",
        "session_fingerprint": fingerprint or f"test_{uuid.uuid4().hex[:8]}",
    })
    assert res.status_code == 200, res.text
    return res.json()["lock_id"]


def _create_order(admin, date_str="2030-08-05", client_name="Alice Client", lock_id=None):
    if lock_id is None:
        lock_id = _hold(admin, date_str)
    res = client.post("/api/payments/create-order", json={
        "admin_id": admin["id"],
        "session_id": admin["session_id"],
        "start_time": f"{date_str}T10:00:00Z",
        "end_time": f"{date_str}T10:30:00Z",
        "client_name": client_name,
        "client_email": f"{client_name.split()[0].lower()}@example.com",
        "client_phone": "+919000000001",
        "notes": "please call on time",
        "lock_id": lock_id,
    })
    assert res.status_code == 200, res.text
    return res.json()


def _pay(order):
    """Completes the order with a correctly signed payment, as Razorpay would return."""
    payment_id = f"pay_{uuid.uuid4().hex[:12]}"
    signature = hmac.new(
        ADMIN_SECRET.encode(),
        f"{order['order_id']}|{payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return client.post("/api/payments/verify", json={
        "booking_id": order["booking_id"],
        "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": payment_id,
        "razorpay_signature": signature,
    })


def _book(admin, date_str="2030-08-05", client_name="Alice Client"):
    order = _create_order(admin, date_str, client_name)
    verified = _pay(order)
    assert verified.status_code == 200, verified.text
    return order


# --------------------------------------------------------------------------------------
# The reported bug: a paid booking must reach the admin's list
# --------------------------------------------------------------------------------------

def test_paid_booking_reaches_the_admin_bookings_api(admin, db):
    order = _book(admin)

    # In the database...
    row = db.query(Booking).filter(Booking.id == order["booking_id"]).one()
    assert (row.status, row.payment_status) == ("confirmed", "completed")
    assert row.admin_id == admin["id"]

    # ...and returned by the endpoint the Bookings page calls.
    listed = client.get("/api/bookings/my-bookings", headers=admin["headers"]).json()
    assert [b["public_id"] for b in listed] == [row.public_id]


def test_listed_booking_carries_the_details_the_page_shows(admin):
    _book(admin)
    booking = client.get("/api/bookings/my-bookings", headers=admin["headers"]).json()[0]

    for field in (
        "public_id", "client_name", "client_email", "client_phone",
        "start_time", "end_time", "status", "payment_status",
        "session_title", "duration_minutes", "created_at",
    ):
        assert field in booking, f"{field} missing from the bookings payload"

    assert booking["client_name"] == "Alice Client"
    assert booking["client_phone"] == "+919000000001"
    assert booking["duration_minutes"] > 0


def test_booking_survives_a_fresh_login(tracked, admin):
    """The database is the source of truth, so a new session must still see it."""
    _book(admin)

    login = client.post("/api/auth/login", json={
        "username_or_email": admin["email"], "password": PASSWORD,
    })
    assert login.status_code == 200
    fresh = {"Authorization": f"Bearer {login.json()['access_token']}"}

    assert len(client.get("/api/bookings/my-bookings", headers=fresh).json()) == 1


# --------------------------------------------------------------------------------------
# Unpaid bookings must not masquerade as confirmed
# --------------------------------------------------------------------------------------

def test_unpaid_order_is_listed_as_pending_not_confirmed(admin, db):
    order = _create_order(admin)  # no payment

    row = db.query(Booking).filter(Booking.id == order["booking_id"]).one()
    assert (row.status, row.payment_status) == ("pending_payment", "pending")

    listed = client.get("/api/bookings/my-bookings", headers=admin["headers"]).json()
    assert [b["status"] for b in listed] == ["pending_payment"]
    assert client.get(
        "/api/bookings/my-bookings?status_filter=confirmed", headers=admin["headers"]
    ).json() == []


def test_forged_signature_never_confirms_a_booking(admin, db):
    order = _create_order(admin)

    res = client.post("/api/payments/verify", json={
        "booking_id": order["booking_id"],
        "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": "pay_forged",
        "razorpay_signature": "0" * 64,
    })
    assert res.status_code == 400

    row = db.query(Booking).filter(Booking.id == order["booking_id"]).one()
    assert row.status == "pending_payment"


# --------------------------------------------------------------------------------------
# Authorization and isolation
# --------------------------------------------------------------------------------------

def test_bookings_require_authentication():
    assert client.get("/api/bookings/my-bookings").status_code == 401


def test_each_admin_sees_only_their_own_bookings(tracked, admin):
    other = _make_admin(tracked, "b")
    _book(admin, "2030-08-05", "Alice Client")
    _book(other, "2030-08-06", "Bob Client")

    mine = client.get("/api/bookings/my-bookings", headers=admin["headers"]).json()
    theirs = client.get("/api/bookings/my-bookings", headers=other["headers"]).json()

    assert [b["client_name"] for b in mine] == ["Alice Client"]
    assert [b["client_name"] for b in theirs] == ["Bob Client"]


def test_status_filter_narrows_without_hiding_valid_bookings(admin):
    _book(admin)

    assert len(client.get(
        "/api/bookings/my-bookings?status_filter=confirmed", headers=admin["headers"]
    ).json()) == 1
    assert client.get(
        "/api/bookings/my-bookings?status_filter=cancelled", headers=admin["headers"]
    ).json() == []
    assert len(client.get("/api/bookings/my-bookings", headers=admin["headers"]).json()) == 1


# --------------------------------------------------------------------------------------
# Cancelling
# --------------------------------------------------------------------------------------

def test_admin_can_cancel_their_own_booking(admin, db):
    order = _book(admin)

    res = client.post(f"/api/bookings/{order['booking_id']}/cancel", headers=admin["headers"])
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"

    db.expire_all()
    assert db.query(Booking).filter(Booking.id == order["booking_id"]).one().status == "cancelled"


def test_admin_cannot_cancel_another_admins_booking(tracked, admin, db):
    other = _make_admin(tracked, "c")
    order = _book(admin)

    # 404 rather than 403: another admin's booking ids should not be probeable.
    res = client.post(f"/api/bookings/{order['booking_id']}/cancel", headers=other["headers"])
    assert res.status_code == 404

    db.expire_all()
    assert db.query(Booking).filter(Booking.id == order["booking_id"]).one().status == "confirmed"


def test_cancelling_twice_is_harmless(admin):
    order = _book(admin)
    first = client.post(f"/api/bookings/{order['booking_id']}/cancel", headers=admin["headers"])
    second = client.post(f"/api/bookings/{order['booking_id']}/cancel", headers=admin["headers"])
    assert first.status_code == second.status_code == 200
    assert second.json()["status"] == "cancelled"
