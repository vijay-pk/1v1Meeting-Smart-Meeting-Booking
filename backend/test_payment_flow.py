"""
End-to-end tests for POST /api/payments/verify.

Proves the endpoint itself -- not just the signature helper -- refuses to confirm a
booking without a valid, correctly-bound gateway signature, and that a rejected payment
leaves the booking unconfirmed.

Rows are built directly and torn down afterwards, so these do not depend on seed state.
"""
import hashlib
import hmac
import secrets
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import encrypt_secret, get_password_hash
from app.main import app
from app.models.models import (
    Booking, Payment, RazorpayConnection, Session as SessionModel, User,
)
from app.services.razorpay_service import SIMULATED_PROVIDER, REAL_PROVIDER

client = TestClient(app)

ADMIN_SECRET = "this_admins_real_razorpay_secret"
ATTACKER_SECRET = "an_unrelated_merchants_secret"
ORDER_ID = "order_RealOrder123456"
PAYMENT_ID = "pay_RealPayment98765"


def sign(secret: str, order_id: str = ORDER_ID, payment_id: str = PAYMENT_ID) -> str:
    return hmac.new(
        secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256
    ).hexdigest()


@pytest.fixture
def pending_booking():
    """An admin with a real Razorpay connection, and one booking awaiting payment."""
    db = SessionLocal()
    uid = uuid.uuid4().hex[:8]
    created = {}
    try:
        admin = User(
            name="Payment Test Admin",
            email=f"paytest_{uid}@testdomain.com",
            password_hash=get_password_hash("SecurePassword123!"),
            role="admin",
            status="ACTIVE",
        )
        db.add(admin)
        db.flush()

        db.add(RazorpayConnection(
            admin_id=admin.id,
            key_id=f"rzp_test_paytest{uid}",
            encrypted_key_secret=encrypt_secret(ADMIN_SECRET),
            connection_status="connected",
        ))

        session_obj = SessionModel(
            admin_id=admin.id, title="Strategy Call",
            duration_minutes=30, price=149700, currency="INR", is_active=True,
        )
        db.add(session_obj)
        db.flush()

        booking = Booking(
            public_id=f"BK-TEST-{uid.upper()}",
            admin_id=admin.id,
            meeting_type_id=session_obj.id,
            client_name="Test Client",
            client_email="client@example.com",
            start_time="2027-03-11T10:00:00Z",
            end_time="2027-03-11T10:30:00Z",
            status="pending_payment",
            payment_status="pending",
            cancellation_token=secrets.token_hex(16),
        )
        db.add(booking)
        db.flush()

        db.add(Payment(
            booking_id=booking.id, admin_id=admin.id, provider=REAL_PROVIDER,
            order_id=ORDER_ID, amount=149700, currency="INR", status="created",
        ))
        db.commit()

        created = {"admin_id": admin.id, "booking_id": booking.id, "session_id": session_obj.id}
        yield created
    finally:
        db.query(Payment).filter(Payment.admin_id == created.get("admin_id")).delete()
        db.query(Booking).filter(Booking.admin_id == created.get("admin_id")).delete()
        db.query(SessionModel).filter(SessionModel.admin_id == created.get("admin_id")).delete()
        db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == created.get("admin_id")).delete()
        db.query(User).filter(User.id == created.get("admin_id")).delete()
        db.commit()
        db.close()


def booking_state(booking_id: str):
    db = SessionLocal()
    try:
        b = db.query(Booking).filter(Booking.id == booking_id).first()
        return b.status, b.payment_status
    finally:
        db.close()


def verify(booking_id, order_id=ORDER_ID, payment_id=PAYMENT_ID, signature=None):
    return client.post("/api/payments/verify", json={
        "booking_id": booking_id,
        "razorpay_order_id": order_id,
        "razorpay_payment_id": payment_id,
        "razorpay_signature": signature,
    })


def test_valid_signature_confirms_the_booking(pending_booking):
    res = verify(pending_booking["booking_id"], signature=sign(ADMIN_SECRET))
    assert res.status_code == 200
    assert res.json()["status"] == "confirmed"
    assert booking_state(pending_booking["booking_id"]) == ("confirmed", "completed")


def test_forged_signature_is_rejected_and_booking_stays_unpaid(pending_booking):
    res = verify(pending_booking["booking_id"], signature="f" * 64)
    assert res.status_code == 400
    assert res.json()["detail"] == "Invalid payment signature"
    assert booking_state(pending_booking["booking_id"]) == ("pending_payment", "pending")


def test_signature_from_another_merchant_is_rejected(pending_booking):
    """A valid signature generated with a different admin's secret must not confirm."""
    res = verify(pending_booking["booking_id"], signature=sign(ATTACKER_SECRET))
    assert res.status_code == 400
    assert booking_state(pending_booking["booking_id"]) == ("pending_payment", "pending")


def test_simulation_prefixes_are_rejected_end_to_end(pending_booking):
    """Regression: these strings once confirmed a booking with no real payment."""
    res = verify(
        pending_booking["booking_id"],
        order_id="order_sim_rcpt_abc", payment_id="pay_sim", signature="sim_ok",
    )
    assert res.status_code == 400
    assert booking_state(pending_booking["booking_id"]) == ("pending_payment", "pending")


def test_order_from_a_different_booking_is_rejected(pending_booking):
    """
    A caller must not present a genuine order/payment/signature triple minted elsewhere.
    The submitted order id has to match the one this booking created.
    """
    foreign_order = "order_SomeOtherOrder99"
    res = verify(
        pending_booking["booking_id"],
        order_id=foreign_order,
        signature=sign(ADMIN_SECRET, order_id=foreign_order),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Payment does not belong to this booking"
    assert booking_state(pending_booking["booking_id"]) == ("pending_payment", "pending")


def test_simulated_payment_cannot_confirm_when_simulation_is_disabled(pending_booking, monkeypatch):
    """A booking created in simulation mode must not confirm on a production host."""
    db = SessionLocal()
    try:
        payment = db.query(Payment).filter(Payment.booking_id == pending_booking["booking_id"]).first()
        payment.provider = SIMULATED_PROVIDER
        db.commit()
    finally:
        db.close()

    monkeypatch.setattr(settings, "PAYMENTS_ALLOW_SIMULATION", False)
    res = verify(pending_booking["booking_id"], signature="sim_anything")
    assert res.status_code == 503
    assert booking_state(pending_booking["booking_id"]) == ("pending_payment", "pending")


def test_simulated_payment_is_never_marked_completed(pending_booking, monkeypatch):
    """With simulation explicitly on, the booking confirms but is not recorded as paid."""
    db = SessionLocal()
    try:
        payment = db.query(Payment).filter(Payment.booking_id == pending_booking["booking_id"]).first()
        payment.provider = SIMULATED_PROVIDER
        db.commit()
    finally:
        db.close()

    monkeypatch.setattr(settings, "PAYMENTS_ALLOW_SIMULATION", True)
    res = verify(pending_booking["booking_id"], signature="sim_anything")
    assert res.status_code == 200
    assert booking_state(pending_booking["booking_id"]) == ("confirmed", "simulated")
