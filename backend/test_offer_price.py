"""
Real Price / Offer Price for regular client meeting types.

Stored in the existing columns: `price` is what the customer pays (the Offer Price when one is set)
and `original_price` is the Real Price. The amount charged is always read from the saved row on the
server. Student types are priced separately and never carry a Real Price.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.api import payments as payments_api
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.main import app, seed_initial_data
from app.models.models import AdminProfile, Booking, Payment, Session as SessionModel, SlotLock, User

# Shared fixtures/helpers (admin signup, Razorpay connection, slot hold) live in test_persistence.
from test_persistence import (  # noqa: F401
    ADMIN_SECRET, PASSWORD, _connect_razorpay, _hold, _make_admin, admin, db, tracked,
)

seed_initial_data()
client = TestClient(app)


def _create(admin, price, original_price=None, **extra):
    body = {"title": "Consult", "description": "", "duration_minutes": 30, "price": price,
            "currency": "INR", "is_active": True, **extra}
    if original_price is not None:
        body["original_price"] = original_price
    return client.post("/api/sessions/", headers=admin["headers"], json=body)


@pytest.fixture
def razorpay_orders(monkeypatch):
    """Captures what is sent to Razorpay (amount in paise, currency)."""
    sent = []

    async def fake_order(**kwargs):
        sent.append({"amount": kwargs.get("amount_in_paise"), "currency": kwargs.get("currency")})
        return {"id": f"order_{uuid.uuid4().hex[:14]}", "amount": kwargs.get("amount_in_paise", 0),
                "currency": "INR", "simulated": False}

    monkeypatch.setattr(payments_api, "create_razorpay_order", fake_order)
    return sent


def _order(admin, session_id, day, extra=None):
    start, end = f"2030-{day}T10:00:00Z", f"2030-{day}T10:30:00Z"
    body = {
        "admin_id": admin["id"], "session_id": session_id, "start_time": start, "end_time": end,
        "client_name": "Alice", "client_email": "alice@example.com", "client_phone": "+919000000001",
        "lock_id": _hold(admin, session_id, start, end), **(extra or {}),
    }
    return client.post("/api/payments/create-order", json=body)


# --- creating and storing -----------------------------------------------------------------

def test_real_1999_offer_999_is_stored_and_shown_publicly(admin):
    res = _create(admin, price=99900, original_price=199900)
    assert res.status_code == 200, res.text
    s = res.json()
    assert (s["price"], s["original_price"]) == (99900, 199900)
    pub = client.get(f"/api/profiles/public/{admin['username']}").json()["sessions"][0]
    assert (pub["price"], pub["original_price"]) == (99900, 199900)


def test_no_offer_means_the_customer_pays_the_real_price(admin):
    s = _create(admin, price=99900).json()
    assert (s["price"], s["original_price"]) == (99900, None)


def test_equal_prices_are_not_a_discount(admin):
    s = _create(admin, price=99900, original_price=99900).json()
    assert (s["price"], s["original_price"]) == (99900, None)


@pytest.mark.parametrize("price,original,why", [
    (150000, 99900, "offer above real"),
    (-100, None, "negative price"),
    (99900, -5, "negative real"),
    (0, 99900, "zero offer"),
    (99900, 0, "zero real with an offer"),
])
def test_invalid_pricing_is_rejected_by_the_backend(admin, price, original, why):
    res = client.post("/api/sessions/", headers=admin["headers"], json={
        "title": "Bad", "duration_minutes": 30, "price": price, "original_price": original, "currency": "INR"})
    assert res.status_code == 400, (why, res.text)


# --- editing -----------------------------------------------------------------------------

def test_an_offer_can_be_added_changed_and_removed(admin):
    sid = _create(admin, price=199900).json()["id"]
    url, h = f"/api/sessions/{sid}", admin["headers"]
    added = client.put(url, headers=h, json={"price": 99900, "original_price": 199900}).json()
    assert (added["price"], added["original_price"]) == (99900, 199900)
    changed = client.put(url, headers=h, json={"price": 149900, "original_price": 199900}).json()
    assert (changed["price"], changed["original_price"]) == (149900, 199900)
    removed = client.put(url, headers=h, json={"price": 199900, "original_price": None}).json()
    assert (removed["price"], removed["original_price"]) == (199900, None)


def test_an_invalid_edit_is_rejected_and_leaves_the_saved_pricing(admin):
    sid = _create(admin, price=99900, original_price=199900).json()["id"]
    bad = client.put(f"/api/sessions/{sid}", headers=admin["headers"], json={"price": 250000, "original_price": 199900})
    assert bad.status_code == 400
    kept = next(s for s in client.get("/api/sessions/", headers=admin["headers"]).json() if s["id"] == sid)
    assert (kept["price"], kept["original_price"]) == (99900, 199900)


def test_toggling_active_does_not_touch_either_price(admin):
    sid = _create(admin, price=99900, original_price=199900).json()["id"]
    client.put(f"/api/sessions/{sid}", headers=admin["headers"], json={"is_active": False})
    s = next(s for s in client.get("/api/sessions/", headers=admin["headers"]).json() if s["id"] == sid)
    assert (s["price"], s["original_price"]) == (99900, 199900)


def test_existing_priced_session_reads_as_real_price_with_no_offer(admin, db):
    """A session saved before this feature has only `price`; it is the Real Price and nothing changes."""
    sid = _create(admin, price=149900).json()["id"]
    row = db.query(SessionModel).filter(SessionModel.id == sid).one()
    assert row.price == 149900 and row.original_price is None


def test_admins_have_independent_pricing_and_cannot_edit_each_others(tracked):
    a, b = _make_admin(tracked, "a"), _make_admin(tracked, "b")
    sa = _create(a, price=99900, original_price=199900).json()
    sb = _create(b, price=50000).json()
    assert client.put(f"/api/sessions/{sa['id']}", headers=b["headers"], json={"price": 100, "original_price": None}).status_code == 404
    pa = client.get(f"/api/profiles/public/{a['username']}").json()["sessions"][0]
    pb = client.get(f"/api/profiles/public/{b['username']}").json()["sessions"][0]
    assert (pa["price"], pa["original_price"]) == (99900, 199900)
    assert (pb["price"], pb["original_price"]) == (50000, None)
    assert sb["original_price"] is None


# --- what is charged ----------------------------------------------------------------------

def test_razorpay_is_charged_exactly_the_offer_price(admin, razorpay_orders, db):
    _connect_razorpay(admin)
    s = _create(admin, price=99900, original_price=199900).json()
    res = _order(admin, s["id"], "09-01")
    assert res.status_code == 200, res.text
    assert razorpay_orders == [{"amount": 99900, "currency": "INR"}]
    assert res.json()["amount"] == 99900
    pay = db.query(Payment).filter(Payment.order_id == res.json()["order_id"]).one()
    assert (pay.amount, pay.original_amount) == (99900, 199900)


def test_razorpay_is_charged_the_real_price_when_there_is_no_offer(admin, razorpay_orders, db):
    _connect_razorpay(admin)
    s = _create(admin, price=199900).json()
    res = _order(admin, s["id"], "09-02")
    assert razorpay_orders == [{"amount": 199900, "currency": "INR"}]
    pay = db.query(Payment).filter(Payment.order_id == res.json()["order_id"]).one()
    assert (pay.amount, pay.original_amount) == (199900, None)


def test_a_price_sent_by_the_browser_is_ignored(admin, razorpay_orders):
    _connect_razorpay(admin)
    s = _create(admin, price=99900, original_price=199900).json()
    res = _order(admin, s["id"], "09-03", extra={"amount": 1, "price": 1, "original_price": 1, "offer_price": 1})
    assert res.status_code == 200
    assert razorpay_orders[-1]["amount"] == 99900 and res.json()["amount"] == 99900


def test_editing_the_price_later_does_not_change_an_existing_booking(admin, razorpay_orders, db):
    _connect_razorpay(admin)
    s = _create(admin, price=99900, original_price=199900).json()
    order = _order(admin, s["id"], "09-04").json()
    client.put(f"/api/sessions/{s['id']}", headers=admin["headers"], json={"price": 500000, "original_price": None})
    db.expire_all()
    pay = db.query(Payment).filter(Payment.order_id == order["order_id"]).one()
    assert (pay.amount, pay.original_amount) == (99900, 199900)
    listed = [b for b in client.get("/api/bookings/my-bookings", headers=admin["headers"]).json() if b["id"] == order["booking_id"]]
    assert listed and listed[0]["price"] == 99900          # the agreed amount, not the new session price
    public = client.get(f"/api/bookings/public/{db.query(Booking).filter(Booking.id == order['booking_id']).one().public_id}").json()
    assert (public["amount"], public["original_amount"]) == (99900, 199900)


def test_create_order_refuses_another_admins_session(tracked, razorpay_orders):
    a, b = _make_admin(tracked, "a"), _make_admin(tracked, "b")
    _connect_razorpay(a)
    sb = _create(b, price=1000).json()
    res = _order(a, sb["id"], "09-05")                  # b's session charged under a's Razorpay account
    assert res.status_code == 404 and razorpay_orders == []


def test_a_zero_priced_session_is_not_sent_to_razorpay(admin, razorpay_orders):
    _connect_razorpay(admin)
    s = _create(admin, price=0).json()
    res = _order(admin, s["id"], "09-06")
    assert res.status_code == 400 and razorpay_orders == []


# --- students are untouched ---------------------------------------------------------------

@pytest.fixture
def super_admin():
    ids = []
    db = SessionLocal()
    u = User(name="Owner", email=f"offer_owner_{uuid.uuid4().hex[:8]}@testdomain.com",
             password_hash=get_password_hash(PASSWORD), role="super_admin", status="ACTIVE")
    db.add(u)
    db.flush()
    db.add(AdminProfile(user_id=u.id, username=f"ow{uuid.uuid4().hex[:8]}"))
    db.commit()
    ids.append(u.id)
    tok = client.post("/api/auth/login", json={"username_or_email": u.email, "password": PASSWORD}).json()["access_token"]
    yield {"id": u.id, "headers": {"Authorization": f"Bearer {tok}"}}
    db.rollback()
    db.query(SessionModel).filter(SessionModel.admin_id == u.id).delete(synchronize_session=False)
    db.query(AdminProfile).filter(AdminProfile.user_id == u.id).delete(synchronize_session=False)
    db.query(User).filter(User.id == u.id).delete(synchronize_session=False)
    db.commit()
    db.close()


def test_student_types_never_carry_a_real_price(super_admin):
    paid = client.post("/api/sessions/", headers=super_admin["headers"], json={
        "title": "Paid student", "duration_minutes": 30, "price": 50000, "original_price": 90000,
        "currency": "INR", "audience": "student_paid"}).json()
    assert (paid["price"], paid["original_price"]) == (50000, None)       # existing paid-student pricing, no offer
    free = client.post("/api/sessions/", headers=super_admin["headers"], json={
        "title": "Free student", "duration_minutes": 30, "price": 9999, "original_price": 99999,
        "currency": "INR", "audience": "student_free"}).json()
    assert (free["price"], free["original_price"]) == (0, None)
    # An edit that tries to attach an offer to a student type is dropped too.
    upd = client.put(f"/api/sessions/{paid['id']}", headers=super_admin["headers"],
                     json={"price": 40000, "original_price": 80000}).json()
    assert (upd["price"], upd["original_price"]) == (40000, None)


def test_a_student_session_cannot_be_bought_through_the_regular_checkout(super_admin, razorpay_orders):
    paid = client.post("/api/sessions/", headers=super_admin["headers"], json={
        "title": "Paid student", "duration_minutes": 30, "price": 50000, "currency": "INR",
        "audience": "student_paid"}).json()
    adm = {"id": super_admin["id"], "headers": super_admin["headers"]}
    res = client.post("/api/payments/create-order", json={
        "admin_id": super_admin["id"], "session_id": paid["id"],
        "start_time": "2030-09-07T10:00:00Z", "end_time": "2030-09-07T10:30:00Z",
        "client_name": "A", "client_email": "a@example.com", "lock_id": "x"})
    assert res.status_code == 404 and razorpay_orders == [] and adm
