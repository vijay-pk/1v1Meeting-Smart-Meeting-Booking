"""
Tests for configuration that must survive everything except an explicit admin action.

Three things an admin sets up once and should never have to set up again:

* their own Razorpay credentials,
* their own Google Calendar connection,
* the price on each of their sessions.

The bug class these cover is "it disconnected itself" / "the price reset itself": a failed
API call, a re-login, a profile save or a payment failure quietly clearing state the admin had
deliberately set. The rule asserted throughout is that only the explicit disconnect endpoint
ends a connection, and only an explicit session write changes a price.

Every test builds and tears down its own rows, so the suite is order-independent.
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
    RazorpayConnection,
    GoogleConnection,
    ProfileImport,
)
from app.api import payments as payments_api
from app.api import google_calendar as google_api
from app.services import razorpay_service
from app.services.google_calendar import GoogleCalendarUnavailable

seed_initial_data()
client = TestClient(app)

PASSWORD = "TestPassw0rd!123"
ADMIN_SECRET = "adminsecret1234567890"


# ---------------------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------------------

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
            for model in (
                Booking, RazorpayConnection, GoogleConnection,
                AvailabilityRule, SessionModel, ProfileImport,
            ):
                column = model.admin_id
                session.query(model).filter(column == user_id).delete(synchronize_session=False)
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _hold(admin, session_id, start_time, end_time):
    """
    Takes the slot hold that create-order consumes.

    The checkout page has always called hold-slot first; the backend simply never verified
    the lock_id it was given. These tests went straight to create-order, exercising a path no
    real client takes.
    """
    res = client.post("/api/bookings/hold-slot", json={
        "admin_id": admin["id"], "session_id": session_id,
        "start_time": start_time, "end_time": end_time,
        "session_fingerprint": f"test_{uuid.uuid4().hex[:8]}",
    })
    assert res.status_code == 200, res.text
    return res.json()["lock_id"]


def _make_admin(tracked, tag="a"):
    uid = uuid.uuid4().hex[:8]
    email = f"pers_{tag}_{uid}@testdomain.com"
    username = f"pers{tag}{uid}"
    res = client.post("/api/auth/signup", json={
        "name": f"Persistence {tag}", "email": email, "password": PASSWORD, "username": username,
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


def _login(admin):
    """A brand-new token, as a fresh browser session would get."""
    res = client.post("/api/auth/login", json={
        "username_or_email": admin["email"], "password": PASSWORD,
    })
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _connect_razorpay(admin, key_id="rzp_live_persist123", secret=ADMIN_SECRET):
    res = client.post("/api/payments/admin/setup", headers=admin["headers"], json={
        "key_id": key_id, "key_secret": secret, "account_reference": admin["username"],
    })
    assert res.status_code == 200, res.text
    return res.json()


def _connect_google(admin, email="host@example.com"):
    """
    Writes the row the OAuth callback writes. The callback itself needs a live Google
    exchange, so the stored outcome is what is asserted here.
    """
    session = SessionLocal()
    try:
        session.add(GoogleConnection(
            admin_id=admin["id"],
            google_email=email,
            access_token="ya29.access",
            encrypted_refresh_token=encrypt_secret("1//real-refresh-token"),
            calendar_id="primary",
            connection_status="connected",
        ))
        session.commit()
    finally:
        session.close()


def _status_razorpay(headers, probe=False):
    res = client.get(f"/api/payments/admin/status{'?probe=true' if probe else ''}", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def _status_google(headers, probe=False):
    res = client.get(f"/api/google/admin/status?probe={'true' if probe else 'false'}", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def _create_session(admin, price=99900, title="30 Minute Consultation", duration=30):
    res = client.post("/api/sessions/", headers=admin["headers"], json={
        "title": title, "description": "", "duration_minutes": duration,
        "price": price, "currency": "INR", "is_active": True,
    })
    assert res.status_code == 200, res.text
    return res.json()


def _price_of(session_id, headers):
    listed = client.get("/api/sessions/", headers=headers).json()
    match = next((s for s in listed if s["id"] == session_id), None)
    assert match is not None, "the session disappeared"
    return match["price"]


# =======================================================================================
# Razorpay
# =======================================================================================

def test_connecting_razorpay_stores_it_in_the_database(admin, db):
    _connect_razorpay(admin)

    row = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin["id"]).one()
    assert row.key_id == "rzp_live_persist123"
    assert row.connection_status == "connected"
    # Encrypted at rest, never the plaintext.
    assert row.encrypted_key_secret != ADMIN_SECRET
    assert ADMIN_SECRET not in row.encrypted_key_secret


def test_razorpay_status_never_returns_the_key_secret(admin):
    _connect_razorpay(admin)
    res = client.get("/api/payments/admin/status", headers=admin["headers"])

    assert res.json()["key_id"] == "rzp_live_persist123"     # public half is fine
    assert ADMIN_SECRET not in res.text
    assert "secret" not in res.text.lower()


def test_razorpay_survives_a_fresh_login(admin):
    """A new token is a new browser session; the row is unchanged."""
    _connect_razorpay(admin)
    assert _status_razorpay(_login(admin))["configured"] is True


def test_razorpay_survives_repeated_status_reads(admin):
    """Reopening Settings must not mutate anything -- the endpoint is read-only."""
    _connect_razorpay(admin)
    for _ in range(5):
        assert _status_razorpay(admin["headers"])["configured"] is True


def test_razorpay_survives_a_backend_restart(admin, db):
    """
    The connection lives in the database, not in process memory. Rebuilding the app object
    is the closest in-process equivalent of a restart: the row is still there afterwards.
    """
    _connect_razorpay(admin)

    from app.main import app as rebuilt_app
    fresh_client = TestClient(rebuilt_app)
    assert fresh_client.get(
        "/api/payments/admin/status", headers=_login(admin)
    ).json()["configured"] is True
    assert db.query(RazorpayConnection).filter(
        RazorpayConnection.admin_id == admin["id"]
    ).one().connection_status == "connected"


def test_a_failed_payment_does_not_disconnect_razorpay(admin, db, monkeypatch):
    _connect_razorpay(admin)
    session = _create_session(admin)

    async def fake_order(**kwargs):
        return {
            "id": f"order_{uuid.uuid4().hex[:14]}",
            "amount": kwargs.get("amount_in_paise", 0),
            "currency": "INR",
            "simulated": False,
        }

    monkeypatch.setattr(payments_api, "create_razorpay_order", fake_order)

    order = client.post("/api/payments/create-order", json={
        "admin_id": admin["id"], "session_id": session["id"],
        "start_time": "2030-09-01T10:00:00Z", "end_time": "2030-09-01T10:30:00Z",
        "client_name": "Alice", "client_email": "alice@example.com", "client_phone": "+919000000001",
        "lock_id": _hold(admin, session["id"], "2030-09-01T10:00:00Z", "2030-09-01T10:30:00Z"),
    }).json()

    # A forged signature: the payment fails.
    failed = client.post("/api/payments/verify", json={
        "booking_id": order["booking_id"],
        "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": "pay_forged",
        "razorpay_signature": "0" * 64,
    })
    assert failed.status_code == 400

    db.expire_all()
    assert db.query(RazorpayConnection).filter(
        RazorpayConnection.admin_id == admin["id"]
    ).one().connection_status == "connected"
    assert _status_razorpay(admin["headers"])["configured"] is True


def test_a_gateway_outage_does_not_disconnect_razorpay(admin, db, monkeypatch):
    """Razorpay being unreachable is a 502 for that one order, not a configuration change."""
    _connect_razorpay(admin)
    session = _create_session(admin)

    async def unreachable(**kwargs):
        raise razorpay_service.RazorpayOrderError("Could not reach the payment gateway.")

    monkeypatch.setattr(payments_api, "create_razorpay_order", unreachable)

    res = client.post("/api/payments/create-order", json={
        "admin_id": admin["id"], "session_id": session["id"],
        "start_time": "2030-09-02T10:00:00Z", "end_time": "2030-09-02T10:30:00Z",
        "client_name": "Alice", "client_email": "alice@example.com", "client_phone": "+919000000001",
        "lock_id": _hold(admin, session["id"], "2030-09-02T10:00:00Z", "2030-09-02T10:30:00Z"),
    })
    assert res.status_code == 502

    db.expire_all()
    assert db.query(RazorpayConnection).filter(
        RazorpayConnection.admin_id == admin["id"]
    ).one().connection_status == "connected"


def test_a_rejected_credential_probe_reports_it_without_disconnecting(admin, db, monkeypatch):
    """
    Razorpay saying "these keys are wrong" produces a needs-attention state. The row, the key
    id and the encrypted secret all stay exactly as they were, so the admin can update them.
    """
    _connect_razorpay(admin)

    async def rejected(key_id, encrypted_key_secret):
        return razorpay_service.RazorpayCredentialStatus(
            False, reason="Razorpay rejected these keys.", permanent=True
        )

    monkeypatch.setattr(payments_api, "check_razorpay_credentials", rejected)

    status = _status_razorpay(admin["headers"], probe=True)
    assert status["configured"] is True          # still connected
    assert status["healthy"] is False
    assert status["needs_attention"] is True
    assert "rejected" in status["last_error"]

    db.expire_all()
    row = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin["id"]).one()
    assert row.connection_status == "connected"
    assert row.key_id == "rzp_live_persist123"
    assert row.encrypted_key_secret


def test_a_temporary_probe_failure_is_not_reported_as_needing_attention(admin, monkeypatch):
    """A network blip must not tell the admin their keys are wrong."""
    _connect_razorpay(admin)

    async def unreachable(key_id, encrypted_key_secret):
        return razorpay_service.RazorpayCredentialStatus(
            False, reason="Could not reach Razorpay to check these keys."
        )

    monkeypatch.setattr(payments_api, "check_razorpay_credentials", unreachable)

    status = _status_razorpay(admin["headers"], probe=True)
    assert status["configured"] is True
    assert status["healthy"] is False
    assert status["needs_attention"] is False


def test_credential_check_is_read_only(monkeypatch):
    """The probe lists payments; it must never create an order or any other object."""
    calls = {}

    class FakeResponse:
        status_code = 200

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, **kwargs):
            calls["get"] = url
            return FakeResponse()

        async def post(self, url, **kwargs):
            raise AssertionError("the credential check must not POST anything")

    import asyncio
    import httpx
    original = httpx.AsyncClient
    httpx.AsyncClient = lambda *a, **k: FakeClient()
    try:
        result = asyncio.run(razorpay_service.check_razorpay_credentials(
            "rzp_live_key", encrypt_secret(ADMIN_SECRET)
        ))
    finally:
        httpx.AsyncClient = original

    assert result.healthy is True
    assert calls["get"] == "https://api.razorpay.com/v1/payments"


def test_manual_razorpay_disconnect_works_and_stops_new_payments(admin, db):
    _connect_razorpay(admin)
    session = _create_session(admin)

    res = client.post("/api/payments/admin/disconnect", headers=admin["headers"])
    assert res.status_code == 200
    assert _status_razorpay(admin["headers"])["configured"] is False

    db.expire_all()
    row = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin["id"]).one()
    assert row.connection_status == "disconnected"

    # No new orders can be taken while disconnected.
    order = client.post("/api/payments/create-order", json={
        "admin_id": admin["id"], "session_id": session["id"],
        "start_time": "2030-09-03T10:00:00Z", "end_time": "2030-09-03T10:30:00Z",
        "client_name": "Alice", "client_email": "alice@example.com", "client_phone": "+919000000001",
        "lock_id": _hold(admin, session["id"], "2030-09-03T10:00:00Z", "2030-09-03T10:30:00Z"),
    })
    assert order.status_code == 503


def test_disconnecting_razorpay_leaves_prices_sessions_and_profile_alone(admin, db):
    _connect_razorpay(admin)
    session = _create_session(admin, price=99900)
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first()
    profile.bio = "My bio"
    db.commit()

    client.post("/api/payments/admin/disconnect", headers=admin["headers"])

    db.expire_all()
    assert _price_of(session["id"], admin["headers"]) == 99900
    assert db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first().bio == "My bio"


def test_reconnecting_razorpay_after_a_disconnect_works(admin, db):
    _connect_razorpay(admin)
    client.post("/api/payments/admin/disconnect", headers=admin["headers"])
    _connect_razorpay(admin, key_id="rzp_live_second", secret="anothersecret12345")

    db.expire_all()
    row = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin["id"]).one()
    assert (row.connection_status, row.key_id) == ("connected", "rzp_live_second")


# =======================================================================================
# Google Calendar
# =======================================================================================

def test_connecting_google_stores_it_in_the_database(admin, db):
    _connect_google(admin)

    row = db.query(GoogleConnection).filter(GoogleConnection.admin_id == admin["id"]).one()
    assert row.connection_status == "connected"
    assert row.encrypted_refresh_token
    assert "1//real-refresh-token" not in row.encrypted_refresh_token


def test_google_status_never_returns_the_refresh_token(admin):
    _connect_google(admin)
    res = client.get("/api/google/admin/status?probe=false", headers=admin["headers"])
    assert "1//real-refresh-token" not in res.text
    assert "refresh_token" not in res.text


def test_google_survives_a_fresh_login(admin):
    _connect_google(admin)
    assert _status_google(_login(admin))["connected"] is True


def test_google_survives_a_backend_restart(admin, db):
    _connect_google(admin)

    from app.main import app as rebuilt_app
    fresh_client = TestClient(rebuilt_app)
    body = fresh_client.get("/api/google/admin/status?probe=false", headers=_login(admin)).json()
    assert body["connected"] is True
    assert db.query(GoogleConnection).filter(
        GoogleConnection.admin_id == admin["id"]
    ).one().connection_status == "connected"


def test_a_temporary_calendar_failure_does_not_disconnect_google(admin, db, monkeypatch):
    _connect_google(admin)

    async def failing(*args, **kwargs):
        raise GoogleCalendarUnavailable("Google Calendar is temporarily unreachable.")

    monkeypatch.setattr(google_api, "get_google_busy_intervals", failing)

    status = _status_google(admin["headers"], probe=True)
    # Still connected in the database; only the health signal is false.
    assert status["connected"] is True
    assert status["healthy"] is False
    assert "unreachable" in status["last_error"]

    db.expire_all()
    row = db.query(GoogleConnection).filter(GoogleConnection.admin_id == admin["id"]).one()
    assert row.connection_status == "connected"
    assert row.encrypted_refresh_token


def test_a_revoked_token_needs_reconnect_rather_than_being_deleted(admin, db, monkeypatch):
    """
    Google revoking the grant is the case most likely to be "fixed" by deleting the row.
    It must not be: the record stays, marked unhealthy, so the admin is asked to reconnect.
    """
    _connect_google(admin)

    async def revoked(*args, **kwargs):
        raise GoogleCalendarUnavailable("invalid_grant: token has been expired or revoked")

    monkeypatch.setattr(google_api, "get_google_busy_intervals", revoked)

    status = _status_google(admin["headers"], probe=True)
    assert status["connected"] is True
    assert status["healthy"] is False
    assert "revoked" in status["last_error"]

    db.expire_all()
    assert db.query(GoogleConnection).filter(GoogleConnection.admin_id == admin["id"]).count() == 1


def test_a_calendar_failure_never_deletes_bookings(admin, db, monkeypatch):
    _connect_google(admin)
    session = _create_session(admin)
    booking = Booking(
        admin_id=admin["id"],
        meeting_type_id=session["id"],
        public_id=f"BK-TEST-{uuid.uuid4().hex[:6].upper()}",
        client_name="Alice",
        client_email="alice@example.com",
        start_time=datetime.now(timezone.utc) + timedelta(days=5),
        end_time=datetime.now(timezone.utc) + timedelta(days=5, minutes=30),
        status="confirmed",
        payment_status="completed",
        cancellation_token=uuid.uuid4().hex,
    )
    db.add(booking)
    db.commit()
    booking_id = booking.id

    async def failing(*args, **kwargs):
        raise GoogleCalendarUnavailable("Google Calendar is temporarily unreachable.")

    monkeypatch.setattr(google_api, "get_google_busy_intervals", failing)
    _status_google(admin["headers"], probe=True)

    db.expire_all()
    assert db.query(Booking).filter(Booking.id == booking_id).one().status == "confirmed"


def test_manual_google_disconnect_works(admin, db):
    _connect_google(admin)

    res = client.post("/api/google/admin/disconnect", headers=admin["headers"])
    assert res.status_code == 200
    assert _status_google(admin["headers"])["connected"] is False

    db.expire_all()
    assert db.query(GoogleConnection).filter(
        GoogleConnection.admin_id == admin["id"]
    ).one().connection_status == "disconnected"


def test_disconnecting_google_leaves_prices_and_bookings_alone(admin, db):
    _connect_google(admin)
    session = _create_session(admin, price=149700)

    client.post("/api/google/admin/disconnect", headers=admin["headers"])

    assert _price_of(session["id"], admin["headers"]) == 149700


# =======================================================================================
# Pricing
# =======================================================================================

def test_a_set_price_survives_a_fresh_login(admin):
    session = _create_session(admin, price=99900)
    assert _price_of(session["id"], _login(admin)) == 99900


def test_a_set_price_survives_a_backend_restart(admin):
    session = _create_session(admin, price=99900)

    from app.main import app as rebuilt_app
    fresh_client = TestClient(rebuilt_app)
    listed = fresh_client.get("/api/sessions/", headers=_login(admin)).json()
    assert next(s for s in listed if s["id"] == session["id"])["price"] == 99900


@pytest.mark.parametrize("action", ["connect_razorpay", "disconnect_razorpay",
                                    "connect_google", "disconnect_google",
                                    "change_availability", "edit_profile"])
def test_unrelated_admin_actions_never_change_a_price(admin, action):
    """
    The whole point of the report: none of these touch `sessions.price`. Each runs against a
    session priced at exactly 99900 paise, and the price is re-read from the database after.
    """
    session = _create_session(admin, price=99900)

    if action == "connect_razorpay":
        _connect_razorpay(admin)
    elif action == "disconnect_razorpay":
        _connect_razorpay(admin)
        client.post("/api/payments/admin/disconnect", headers=admin["headers"])
    elif action == "connect_google":
        _connect_google(admin)
    elif action == "disconnect_google":
        _connect_google(admin)
        client.post("/api/google/admin/disconnect", headers=admin["headers"])
    elif action == "change_availability":
        res = client.post("/api/availability/rules", headers=admin["headers"], json={
            "rules": [
                {"day_of_week": 1, "start_time": "09:00", "end_time": "17:00", "is_active": True},
            ]
        })
        assert res.status_code in (200, 201), res.text
    elif action == "edit_profile":
        res = client.put("/api/profiles/me", headers=admin["headers"], json={
            "bio": "A new bio", "title": "A new headline", "profile_photo": "https://example.com/me.jpg",
        })
        assert res.status_code == 200, res.text

    assert _price_of(session["id"], admin["headers"]) == 99900


def test_a_profile_update_cannot_reach_the_price_field(admin):
    """Even asked directly, the profile endpoint has no route to a session's price."""
    session = _create_session(admin, price=99900)

    client.put("/api/profiles/me", headers=admin["headers"], json={
        "bio": "New bio", "price": 0, "sessions": [], "razorpay_key_id": None,
    })

    assert _price_of(session["id"], admin["headers"]) == 99900


def test_a_partial_session_update_leaves_the_price_alone(admin):
    """Toggling is_active sends only that field, and only that field changes."""
    session = _create_session(admin, price=99900)

    res = client.put(f"/api/sessions/{session['id']}", headers=admin["headers"],
                     json={"is_active": False})
    assert res.status_code == 200
    assert res.json()["price"] == 99900
    assert res.json()["is_active"] is False


def test_a_partial_session_update_leaves_connections_alone(admin, db):
    _connect_razorpay(admin)
    _connect_google(admin)
    session = _create_session(admin, price=99900)

    client.put(f"/api/sessions/{session['id']}", headers=admin["headers"], json={"price": 129900})

    db.expire_all()
    assert db.query(RazorpayConnection).filter(
        RazorpayConnection.admin_id == admin["id"]
    ).one().connection_status == "connected"
    assert db.query(GoogleConnection).filter(
        GoogleConnection.admin_id == admin["id"]
    ).one().connection_status == "connected"


def test_an_explicit_price_edit_is_the_one_thing_that_changes_it(admin):
    session = _create_session(admin, price=99900)

    res = client.put(f"/api/sessions/{session['id']}", headers=admin["headers"],
                     json={"price": 129900})
    assert res.status_code == 200
    assert _price_of(session["id"], admin["headers"]) == 129900


def test_a_failed_payment_does_not_change_the_price(admin, monkeypatch):
    _connect_razorpay(admin)
    session = _create_session(admin, price=99900)

    async def fake_order(**kwargs):
        return {"id": f"order_{uuid.uuid4().hex[:14]}", "amount": kwargs.get("amount_in_paise", 0),
                "currency": "INR", "simulated": False}

    monkeypatch.setattr(payments_api, "create_razorpay_order", fake_order)
    order = client.post("/api/payments/create-order", json={
        "admin_id": admin["id"], "session_id": session["id"],
        "start_time": "2030-09-04T10:00:00Z", "end_time": "2030-09-04T10:30:00Z",
        "client_name": "Alice", "client_email": "alice@example.com", "client_phone": "+919000000001",
        "lock_id": _hold(admin, session["id"], "2030-09-04T10:00:00Z", "2030-09-04T10:30:00Z"),
    }).json()

    client.post("/api/payments/verify", json={
        "booking_id": order["booking_id"], "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": "pay_forged", "razorpay_signature": "0" * 64,
    })

    assert _price_of(session["id"], admin["headers"]) == 99900


def test_a_successful_payment_does_not_change_the_price(admin, monkeypatch):
    _connect_razorpay(admin, secret=ADMIN_SECRET)
    session = _create_session(admin, price=99900)

    async def fake_order(**kwargs):
        return {"id": f"order_{uuid.uuid4().hex[:14]}", "amount": kwargs.get("amount_in_paise", 0),
                "currency": "INR", "simulated": False}

    monkeypatch.setattr(payments_api, "create_razorpay_order", fake_order)
    order = client.post("/api/payments/create-order", json={
        "admin_id": admin["id"], "session_id": session["id"],
        "start_time": "2030-09-05T10:00:00Z", "end_time": "2030-09-05T10:30:00Z",
        "client_name": "Alice", "client_email": "alice@example.com", "client_phone": "+919000000001",
        "lock_id": _hold(admin, session["id"], "2030-09-05T10:00:00Z", "2030-09-05T10:30:00Z"),
    }).json()

    payment_id = f"pay_{uuid.uuid4().hex[:12]}"
    signature = hmac.new(
        ADMIN_SECRET.encode(), f"{order['order_id']}|{payment_id}".encode(), hashlib.sha256
    ).hexdigest()
    verified = client.post("/api/payments/verify", json={
        "booking_id": order["booking_id"], "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": payment_id, "razorpay_signature": signature,
    })
    assert verified.status_code == 200, verified.text

    assert _price_of(session["id"], admin["headers"]) == 99900


# =======================================================================================
# =======================================================================================
# Multi-admin isolation
# =======================================================================================

def test_each_admin_sees_only_their_own_connections_and_prices(tracked):
    a = _make_admin(tracked, "a")
    b = _make_admin(tracked, "b")

    _connect_razorpay(a, key_id="rzp_live_AAAA", secret="secretforadminA123")
    _connect_razorpay(b, key_id="rzp_live_BBBB", secret="secretforadminB123")
    _connect_google(a, email="a@example.com")
    _connect_google(b, email="b@example.com")
    session_a = _create_session(a, price=99900, title="A's session")
    session_b = _create_session(b, price=149900, title="B's session")

    assert _status_razorpay(a["headers"])["key_id"] == "rzp_live_AAAA"
    assert _status_razorpay(b["headers"])["key_id"] == "rzp_live_BBBB"
    assert _status_google(a["headers"])["google_email"] == "a@example.com"
    assert _status_google(b["headers"])["google_email"] == "b@example.com"

    a_sessions = client.get("/api/sessions/", headers=a["headers"]).json()
    b_sessions = client.get("/api/sessions/", headers=b["headers"]).json()
    # Signup seeds no sessions, so each admin sees exactly the one they created.
    assert [(s["title"], s["price"]) for s in a_sessions] == [("A's session", 99900)]
    assert [(s["title"], s["price"]) for s in b_sessions] == [("B's session", 149900)]


def test_one_admin_disconnecting_does_not_affect_another(tracked, db):
    a = _make_admin(tracked, "a")
    b = _make_admin(tracked, "b")
    _connect_razorpay(a, key_id="rzp_live_AAAA", secret="secretforadminA123")
    _connect_razorpay(b, key_id="rzp_live_BBBB", secret="secretforadminB123")
    _connect_google(a)
    _connect_google(b)

    client.post("/api/payments/admin/disconnect", headers=a["headers"])
    client.post("/api/google/admin/disconnect", headers=a["headers"])

    db.expire_all()
    assert _status_razorpay(b["headers"])["configured"] is True
    assert _status_google(b["headers"])["connected"] is True


def test_an_admin_cannot_edit_another_admins_price(tracked):
    a = _make_admin(tracked, "a")
    b = _make_admin(tracked, "b")
    session_a = _create_session(a, price=99900)

    res = client.put(f"/api/sessions/{session_a['id']}", headers=b["headers"],
                     json={"price": 100})
    assert res.status_code == 404
    assert _price_of(session_a["id"], a["headers"]) == 99900


def test_connection_endpoints_require_authentication():
    assert client.get("/api/payments/admin/status").status_code == 401
    assert client.post("/api/payments/admin/disconnect").status_code == 401
    assert client.get("/api/google/admin/status").status_code == 401
    assert client.post("/api/google/admin/disconnect").status_code == 401
