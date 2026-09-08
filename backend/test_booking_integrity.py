"""
The guarantees that stop two people buying the same half hour, and stop the product lying
about what it delivered.

Every defect covered here shipped under a fully green suite, because nothing exercised these
paths:

- create-order accepted a lock_id and never looked at it, so the hold taken by the checkout
  page reserved nothing.
- Both conflict checks matched status == "confirmed" only, so a client part-way through
  paying occupied no slot at all.
- The schema declared no unique constraint, so even a correct check could not settle a race:
  two requests both read "free" before either wrote.
- google_calendar.py returned "https://meet.google.com/new" on every failure path, and that
  fabricated link was stored on the booking and emailed to the client.
- email_service.py logged and returned True, so an email that was never sent reported success.
- Session.max_advance_days existed from the first migration and was never read.

The assertions below are the specification. Do not relax one to make a change pass.
"""
import hashlib
import hmac
import uuid
from datetime import datetime, timedelta, timezone

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
    Notification,
    RazorpayConnection,
    SlotLock,
)
from app.api import payments as payments_api
from app.services import booking_slots

seed_initial_data()
client = TestClient(app)

PASSWORD = "TestPassw0rd!123"
ADMIN_SECRET = "adminsecret1234567890"
SLOT_DAY = "2030-07-15"
SLOT_START = f"{SLOT_DAY}T11:00:00Z"
SLOT_END = f"{SLOT_DAY}T11:30:00Z"


@pytest.fixture(autouse=True)
def stub_gateway(monkeypatch):
    """Stubs only the outbound Razorpay call. Signature verification stays real."""
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
            for model in (Booking, SlotLock, Notification, RazorpayConnection,
                          AvailabilityRule, SessionModel):
                session.query(model).filter(
                    model.admin_id == user_id
                ).delete(synchronize_session=False)
            session.query(AdminProfile).filter(
                AdminProfile.user_id == user_id
            ).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _make_admin(tracked, tag="i", max_advance_days=3650):
    uid = uuid.uuid4().hex[:8]
    res = client.post("/api/auth/signup", json={
        "name": f"Integrity {tag}",
        "email": f"bi_{tag}_{uid}@testdomain.com",
        "password": PASSWORD,
        "username": f"bi{tag}{uid}",
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
    created = client.post("/api/sessions/", headers=headers, json={
        "title": "Integrity Consultation", "description": "", "duration_minutes": 30,
        "price": 99900, "currency": "INR", "is_active": True,
        "max_advance_days": max_advance_days,
    })
    assert created.status_code == 200, created.text
    return {
        "id": data["user_id"],
        "headers": headers,
        "session_id": created.json()["id"],
    }


@pytest.fixture
def admin(tracked):
    return _make_admin(tracked)


def _hold(admin, start=SLOT_START, end=SLOT_END, fingerprint=None):
    res = client.post("/api/bookings/hold-slot", json={
        "admin_id": admin["id"], "session_id": admin["session_id"],
        "start_time": start, "end_time": end,
        "session_fingerprint": fingerprint or f"fp_{uuid.uuid4().hex[:8]}",
    })
    return res


def _order(admin, lock_id, start=SLOT_START, end=SLOT_END, name="Alice"):
    return client.post("/api/payments/create-order", json={
        "admin_id": admin["id"], "session_id": admin["session_id"],
        "start_time": start, "end_time": end,
        "client_name": name, "client_email": f"{name.lower()}@example.com",
        "client_phone": "+919000000001", "lock_id": lock_id,
    })


def _pay(order_json):
    payment_id = f"pay_{uuid.uuid4().hex[:12]}"
    signature = hmac.new(
        ADMIN_SECRET.encode(),
        f"{order_json['order_id']}|{payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return client.post("/api/payments/verify", json={
        "booking_id": order_json["booking_id"],
        "razorpay_order_id": order_json["order_id"],
        "razorpay_payment_id": payment_id,
        "razorpay_signature": signature,
    })


# --------------------------------------------------------------------------------------
# The hold must actually reserve the slot
# --------------------------------------------------------------------------------------

def test_an_order_without_a_hold_is_refused(admin):
    """
    lock_id used to be declared on the request and never read, so the hold was decorative.
    """
    res = _order(admin, lock_id=None)
    assert res.status_code == 409, res.text
    assert "held" in res.json()["detail"].lower()


def test_an_order_with_an_unknown_lock_is_refused(admin):
    res = _order(admin, lock_id=str(uuid.uuid4()))
    assert res.status_code == 409, res.text


def test_a_lock_for_a_different_slot_cannot_buy_this_one(admin):
    """A hold on 09:00 must not authorise a booking at 11:00."""
    other = _hold(admin, start=f"{SLOT_DAY}T09:00:00Z", end=f"{SLOT_DAY}T09:30:00Z")
    assert other.status_code == 200, other.text
    res = _order(admin, lock_id=other.json()["lock_id"])
    assert res.status_code == 409, res.text


def test_an_expired_hold_cannot_buy_the_slot(admin, db):
    held = _hold(admin)
    assert held.status_code == 200, held.text
    lock_id = held.json()["lock_id"]

    lock = db.query(SlotLock).filter(SlotLock.id == lock_id).one()
    lock.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    res = _order(admin, lock_id=lock_id)
    assert res.status_code == 409, res.text
    assert "expired" in res.json()["detail"].lower()


def test_a_valid_hold_buys_the_slot(admin):
    held = _hold(admin)
    assert held.status_code == 200, held.text
    res = _order(admin, lock_id=held.json()["lock_id"])
    assert res.status_code == 200, res.text


# --------------------------------------------------------------------------------------
# One slot, one booking
# --------------------------------------------------------------------------------------

def test_a_checkout_in_progress_blocks_a_second_order(admin):
    """
    The conflict checks matched only "confirmed", so a client part-way through paying
    occupied nothing and a second client could start buying the same slot.
    """
    first = _hold(admin, fingerprint="client_one")
    assert _order(admin, first.json()["lock_id"], name="Alice").status_code == 200

    # The hold is gone from this client's perspective, but even handed a fresh one the
    # pending booking must stand in the way.
    second = _order(admin, first.json()["lock_id"], name="Bob")
    assert second.status_code == 409, second.text


def test_the_database_refuses_a_duplicate_even_when_the_check_is_bypassed(admin, db):
    """
    The check is a SELECT then an INSERT with no locking, so two requests can both read
    "free" before either commits. Only the partial unique index from migration 004 can
    settle that, and this asserts the index is actually present and enforcing.
    """
    held = _hold(admin)
    assert _order(admin, held.json()["lock_id"]).status_code == 200

    # Write directly, exactly as a racing request would after passing its own SELECT.
    duplicate = Booking(
        public_id=f"BK-DUP-{uuid.uuid4().hex[:6].upper()}",
        admin_id=admin["id"],
        meeting_type_id=admin["session_id"],
        client_name="Racer", client_email="racer@example.com",
        start_time=SLOT_START, end_time=SLOT_END,
        status="pending_payment", payment_status="pending",
        cancellation_token=uuid.uuid4().hex,
    )
    db.add(duplicate)
    with pytest.raises(Exception):
        db.commit()
    db.rollback()


def test_a_cancelled_booking_frees_its_slot_again(admin, db):
    """The index is partial on purpose: cancelling must put the time back on sale."""
    held = _hold(admin)
    first = _order(admin, held.json()["lock_id"])
    assert first.status_code == 200

    booking = db.query(Booking).filter(Booking.id == first.json()["booking_id"]).one()
    booking.status = "cancelled"
    db.commit()

    again = _hold(admin, fingerprint="second_client")
    assert again.status_code == 200, again.text
    assert _order(admin, again.json()["lock_id"], name="Bob").status_code == 200


def test_an_abandoned_checkout_stops_holding_the_slot(admin, db):
    """
    A client who opens Razorpay and closes the tab leaves a pending_payment row forever.
    Nothing swept them, so one closed tab took a slot off the calendar permanently -- and
    once pending rows started blocking, that became unbookable rather than merely untidy.
    """
    held = _hold(admin)
    first = _order(admin, held.json()["lock_id"])
    assert first.status_code == 200

    booking = db.query(Booking).filter(Booking.id == first.json()["booking_id"]).one()
    booking.created_at = datetime.now(timezone.utc) - timedelta(
        minutes=booking_slots.ABANDONED_CHECKOUT_MINUTES + 5
    )
    db.commit()

    again = _hold(admin, fingerprint="later_client")
    assert again.status_code == 200, again.text
    retry = _order(admin, again.json()["lock_id"], name="Bob")
    assert retry.status_code == 200, retry.text

    db.expire_all()
    assert db.query(Booking).filter(Booking.id == first.json()["booking_id"]).one().status == "expired"


# --------------------------------------------------------------------------------------
# Never invent a meeting link
# --------------------------------------------------------------------------------------

@pytest.mark.parametrize("failure", ["api_error", "exception"])
def test_a_calendar_failure_produces_no_link_rather_than_a_fake_one(admin, db, monkeypatch, failure):
    """
    The old code returned "https://meet.google.com/new" from every failure path. That link
    looks like an invitation and drops the client into an empty meeting.
    """
    from app.models.models import GoogleConnection
    db.add(GoogleConnection(
        admin_id=admin["id"],
        encrypted_refresh_token=encrypt_secret("refresh-token"),
        google_email="host@example.com",
        connection_status="connected",
    ))
    db.commit()

    async def failing_event(**kwargs):
        return {"event_id": None, "meet_link": None, "html_link": None, "error": failure}

    monkeypatch.setattr(payments_api, "create_calendar_event_with_meet", failing_event)

    held = _hold(admin)
    order = _order(admin, held.json()["lock_id"]).json()
    verified = _pay(order)

    assert verified.status_code == 200, verified.text
    body = verified.json()
    # The payment succeeded, so the booking stands.
    assert body["status"] == "confirmed"
    # But no link is invented.
    assert body["google_meet_link"] is None
    assert body["meeting_link_pending"] is True

    db.expire_all()
    stored = db.query(Booking).filter(Booking.id == order["booking_id"]).one()
    assert stored.google_meet_link is None
    assert stored.status == "confirmed"

    # And the host is told, rather than discovering it from a confused client.
    alerts = db.query(Notification).filter(
        Notification.admin_id == admin["id"], Notification.type == "calendar_failed"
    ).all()
    assert alerts, "host was not notified that the meeting link is missing"


def test_no_code_path_assigns_a_hardcoded_meet_link():
    """
    A structural guard against the fabricated link returning.

    Parses google_calendar.py and finds every dict literal carrying a "meet_link" key. A
    meeting URL may only ever come from Google's own response, so none of those values may
    be a hardcoded string -- it has to be a variable or None. Comments and docstrings that
    discuss the old behaviour are invisible to this, which a text search could not manage.
    """
    import ast
    from pathlib import Path

    source = Path(__file__).resolve().parent / "app" / "services" / "google_calendar.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))

    literals = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for key, value in zip(node.keys, node.values):
            if isinstance(key, ast.Constant) and key.value == "meet_link":
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    literals.append((node.lineno, value.value))

    assert not literals, f"meet_link assigned a hardcoded URL at {literals}"


# --------------------------------------------------------------------------------------
# Email reports what actually happened
# --------------------------------------------------------------------------------------

@pytest.mark.anyio
async def test_unconfigured_email_reports_failure_not_success(monkeypatch):
    """
    The mock returned True unconditionally, so every caller believed the client had been
    emailed. An unsent email must read as unsent.
    """
    from app.services import email_service
    monkeypatch.setattr(email_service.settings, "RESEND_API_KEY", "", raising=False)
    monkeypatch.setattr(email_service.settings, "EMAIL_FROM_ADDRESS", "", raising=False)

    sent = await email_service.send_booking_confirmation_email(
        to_email="client@example.com", client_name="Alice", admin_name="Host",
        session_title="Consult", start_time=SLOT_START, duration_minutes=30,
        meet_link=None,
    )
    assert sent is False


def test_email_body_names_the_timezone_and_never_fakes_a_link():
    from app.services import email_service
    when = email_service._format_when(SLOT_START, 30)
    assert "Z" not in when, "the cosmetic UTC marker must not reach a human"
    assert email_service.settings.BUSINESS_TIMEZONE in when

    block = email_service._meeting_link_block(None)
    assert "meet.google.com" not in block
    assert "still being generated" in block


# --------------------------------------------------------------------------------------
# Booking horizon
# --------------------------------------------------------------------------------------

def test_a_date_beyond_the_horizon_offers_no_slots(tracked):
    """max_advance_days was on the model from the start and never read."""
    admin = _make_admin(tracked, tag="h", max_advance_days=30)
    client.post("/api/availability/rules", headers=admin["headers"], json={
        "rules": [
            {"day_of_week": d, "start_time": "09:00", "end_time": "18:00", "is_active": True}
            for d in range(7)
        ]
    })
    far = (datetime.now(timezone.utc) + timedelta(days=200)).strftime("%Y-%m-%d")
    res = client.get(
        f"/api/availability/slots?admin_id={admin['id']}"
        f"&session_id={admin['session_id']}&date_str={far}"
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["available_slots"] == []
    assert "30 days" in body["message"]


def test_a_past_date_offers_no_slots(admin):
    past = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d")
    res = client.get(
        f"/api/availability/slots?admin_id={admin['id']}"
        f"&session_id={admin['session_id']}&date_str={past}"
    )
    assert res.status_code == 200, res.text
    assert res.json()["available_slots"] == []


def test_every_slot_response_names_the_timezone_it_computed_in(admin):
    """
    The UI used to caption these times with the browser's zone. A London client saw IST
    slots labelled Europe/London and would arrive five and a half hours late.
    """
    res = client.get(
        f"/api/availability/slots?admin_id={admin['id']}"
        f"&session_id={admin['session_id']}&date_str={SLOT_DAY}"
    )
    assert res.status_code == 200, res.text
    assert res.json()["timezone"]


# --------------------------------------------------------------------------------------
# Batch slot counts (what the date strip is built from)
# --------------------------------------------------------------------------------------

def test_slot_counts_agree_with_the_slots_behind_them(tracked):
    """
    A pill saying "3 slots" that opens onto two is worse than no count at all, so the count
    endpoint runs the same engine rather than approximating.
    """
    admin = _make_admin(tracked, tag="c", max_advance_days=3650)
    client.post("/api/availability/rules", headers=admin["headers"], json={
        "rules": [
            {"day_of_week": d, "start_time": "09:00", "end_time": "12:00", "is_active": True}
            for d in range(7)
        ]
    })

    res = client.get(
        f"/api/availability/slot-counts?admin_id={admin['id']}"
        f"&session_id={admin['session_id']}&days=3"
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["days"]) == 3
    assert body["timezone"]

    for day in body["days"]:
        detail = client.get(
            f"/api/availability/slots?admin_id={admin['id']}"
            f"&session_id={admin['session_id']}&date_str={day['date']}"
        ).json()
        assert day["count"] == len(detail["available_slots"]), day["date"]


def test_slot_counts_are_bounded(admin):
    """An unbounded days parameter would run the whole engine an arbitrary number of times."""
    assert client.get(
        f"/api/availability/slot-counts?admin_id={admin['id']}"
        f"&session_id={admin['session_id']}&days=90"
    ).status_code == 422


# --------------------------------------------------------------------------------------
# Booking sends no email, and puts one shared event on both calendars
# --------------------------------------------------------------------------------------

def _connect_google(db, admin_id, calendar_id="primary"):
    from app.models.models import GoogleConnection
    db.add(GoogleConnection(
        admin_id=admin_id,
        encrypted_refresh_token=encrypt_secret("refresh-token"),
        google_email="host@example.com",
        calendar_id=calendar_id,
        connection_status="connected",
    ))
    db.commit()


def test_a_confirmed_booking_sends_no_email(admin, db, monkeypatch):
    """
    Booking email is deliberately off. The client learns the details from the confirmation
    screen and Google's calendar invitation; the host from the in-app notification.

    Asserted by making any send raise: if the booking flow ever calls one again, this fails
    rather than quietly resuming a behaviour that was removed on purpose.
    """
    from app.services import email_service

    async def must_not_send(*args, **kwargs):
        raise AssertionError("the booking flow must not send email")

    monkeypatch.setattr(email_service, "send_booking_confirmation_email", must_not_send)
    monkeypatch.setattr(email_service, "send_admin_new_booking_notification", must_not_send)

    held = _hold(admin)
    order = _order(admin, held.json()["lock_id"]).json()
    verified = _pay(order)

    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "confirmed"


def test_the_client_is_invited_so_the_event_reaches_their_calendar(admin, db, monkeypatch):
    """
    There is no client account in this product, so no client calendar to write to directly.
    The single shared event with the client as an attendee is the only mechanism -- and it
    only reaches them if Google is told to notify attendees.

    sendUpdates defaults to "none". Without it the client was listed on the host's event and
    never told, which is the whole of the missing-client-calendar bug.
    """
    _connect_google(db, admin["id"], calendar_id="work@example.com")
    captured = {}

    async def fake_event(**kwargs):
        captured.update(kwargs)
        return {
            "event_id": "evt_123",
            "meet_link": "https://meet.google.com/real-link",
            "html_link": "https://calendar.google.com/x",
        }

    monkeypatch.setattr(payments_api, "create_calendar_event_with_meet", fake_event)

    held = _hold(admin)
    order = _order(admin, held.json()["lock_id"]).json()
    assert _pay(order).status_code == 200

    # The admin's chosen calendar, not a hardcoded "primary".
    assert captured["calendar_id"] == "work@example.com"
    # The client is on the event.
    assert captured["client_email"].endswith("@example.com")
    # Idempotency key is derived from the booking, so a retry cannot mint a second Meet link.
    assert captured["idempotency_key"] == f"bmm_{order['booking_id']}"


def test_the_event_request_asks_google_to_notify_attendees():
    """
    Guards the parameter itself. A structural check, because the behaviour it controls
    (an invitation actually arriving) cannot be asserted without live Google credentials.
    """
    from pathlib import Path
    source = Path(__file__).resolve().parent / "app" / "services" / "google_calendar.py"
    text = source.read_text(encoding="utf-8")
    assert "sendUpdates=all" in text, "attendees would not be notified"
    assert "calendars/primary/events" not in text, "the admin's chosen calendar is ignored"


def test_a_retry_does_not_create_a_second_calendar_event(admin, db, monkeypatch):
    """A booking that already carries an event id must never ask Google for another."""
    _connect_google(db, admin["id"])
    calls = {"n": 0}

    async def counting_event(**kwargs):
        calls["n"] += 1
        return {"event_id": "evt_once", "meet_link": "https://meet.google.com/x", "html_link": None}

    monkeypatch.setattr(payments_api, "create_calendar_event_with_meet", counting_event)

    held = _hold(admin)
    order = _order(admin, held.json()["lock_id"]).json()
    assert _pay(order).status_code == 200
    assert calls["n"] == 1

    # Replaying /verify returns the same booking without touching Google again.
    again = _pay(order)
    assert again.status_code == 200
    assert calls["n"] == 1, "a retry created a second calendar event"
    assert again.json()["google_meet_link"] == "https://meet.google.com/x"


def test_two_clients_racing_one_slot_produce_one_booking(admin, db):
    """
    Client A succeeds, client B is refused. Never both.

    Both hold attempts and both orders are exercised; the database index is the thing that
    actually settles it, and this asserts exactly one booking survives.
    """
    first = _hold(admin, fingerprint="client_a")
    assert first.status_code == 200

    # B cannot even take the hold while A has it.
    second = _hold(admin, fingerprint="client_b")
    assert second.status_code == 409, second.text

    assert _order(admin, first.json()["lock_id"], name="Alice").status_code == 200

    # And with a hold in hand from elsewhere, B's order is still refused.
    third = _order(admin, first.json()["lock_id"], name="Bob")
    assert third.status_code == 409, third.text

    live = (
        db.query(Booking)
        .filter(
            Booking.admin_id == admin["id"],
            Booking.start_time == SLOT_START,
            Booking.status.in_(["confirmed", "pending_payment"]),
        )
        .all()
    )
    assert len(live) == 1, f"expected exactly one live booking, found {len(live)}"
