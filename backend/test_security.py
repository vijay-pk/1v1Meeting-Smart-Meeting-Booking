"""
Security regression tests for payment verification and password hashing.

These cover the three bypasses that previously allowed authentication or payment
confirmation to succeed without a valid credential. Do not relax an assertion here to
make a change pass -- each one encodes a fix-closed guarantee.

Runs without a database or a live app: these exercise the security units directly.
"""
import asyncio
import hashlib
import hmac

import bcrypt
import pytest

from app.core.config import settings
from app.core.security import (
    encrypt_secret,
    decrypt_secret,
    get_password_hash,
    verify_password,
    SecretDecryptionError,
)
from app.services.razorpay_service import (
    create_razorpay_order,
    verify_razorpay_signature,
    RazorpayConfigurationError,
    SIMULATED_PROVIDER,
)

REAL_KEY_ID = "rzp_test_realmerchant01"
REAL_SECRET = "a_real_looking_razorpay_secret"
OTHER_SECRET = "a_different_admins_secret"
ORDER_ID = "order_MNo1Xk9pQrStUv"
PAYMENT_ID = "pay_MNo2Yl0qRsTuVw"


def sign(secret: str, order_id: str = ORDER_ID, payment_id: str = PAYMENT_ID) -> str:
    """Produces a signature exactly as Razorpay's gateway would."""
    return hmac.new(
        secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256
    ).hexdigest()


# ---------------------------------------------------------------------------
# Razorpay signature verification
# ---------------------------------------------------------------------------

def test_valid_signature_is_accepted():
    enc = encrypt_secret(REAL_SECRET)
    assert verify_razorpay_signature(enc, ORDER_ID, PAYMENT_ID, sign(REAL_SECRET)) is True


def test_signature_from_a_different_admins_secret_is_rejected():
    """The core multi-tenant guarantee: one admin's secret cannot confirm another's payment."""
    enc = encrypt_secret(REAL_SECRET)
    assert verify_razorpay_signature(enc, ORDER_ID, PAYMENT_ID, sign(OTHER_SECRET)) is False


def test_garbage_signature_is_rejected():
    enc = encrypt_secret(REAL_SECRET)
    assert verify_razorpay_signature(enc, ORDER_ID, PAYMENT_ID, "not_a_signature") is False
    assert verify_razorpay_signature(enc, ORDER_ID, PAYMENT_ID, "0" * 64) is False


def test_tampered_order_or_payment_id_is_rejected():
    """A signature is bound to its exact order|payment pair."""
    enc = encrypt_secret(REAL_SECRET)
    good = sign(REAL_SECRET)
    assert verify_razorpay_signature(enc, "order_TAMPERED", PAYMENT_ID, good) is False
    assert verify_razorpay_signature(enc, ORDER_ID, "pay_TAMPERED", good) is False


@pytest.mark.parametrize(
    "order_id,signature",
    [
        ("order_sim_rcpt_abc123", "sim_anything"),
        ("order_sim_rcpt_abc123", "deadbeef"),
        (ORDER_ID, "sim_bypass_attempt"),
        ("order_sim_", "sim_"),
    ],
)
def test_simulation_prefixes_do_not_bypass_verification(order_id, signature):
    """
    Regression: order ids starting with "order_sim_" and signatures starting with "sim_"
    once returned True unconditionally -- even when a real secret was configured. These
    strings arrive from the client and must carry no authority whatsoever.
    """
    enc = encrypt_secret(REAL_SECRET)
    assert verify_razorpay_signature(enc, order_id, PAYMENT_ID, signature) is False


def test_missing_secret_never_passes():
    """Regression: an admin with no stored secret must not verify anything."""
    assert verify_razorpay_signature("", ORDER_ID, PAYMENT_ID, sign(REAL_SECRET)) is False
    assert verify_razorpay_signature("", "order_sim_x", PAYMENT_ID, "sim_x") is False


@pytest.mark.parametrize(
    "order_id,payment_id,signature",
    [("", PAYMENT_ID, "sig"), (ORDER_ID, "", "sig"), (ORDER_ID, PAYMENT_ID, "")],
)
def test_empty_inputs_are_rejected(order_id, payment_id, signature):
    enc = encrypt_secret(REAL_SECRET)
    assert verify_razorpay_signature(enc, order_id, payment_id, signature) is False


def test_undecryptable_secret_raises_rather_than_reporting_a_bad_signature():
    """
    A wrong ENCRYPTION_KEY is a server fault, not a customer's invalid payment.
    It must surface as an error, and must never silently verify against ciphertext.
    """
    with pytest.raises(SecretDecryptionError):
        verify_razorpay_signature("not-valid-fernet-ciphertext", ORDER_ID, PAYMENT_ID, "sig")


def test_decrypt_secret_does_not_return_ciphertext_on_failure():
    with pytest.raises(SecretDecryptionError):
        decrypt_secret("clearly-not-fernet")


def test_encrypt_decrypt_roundtrip():
    assert decrypt_secret(encrypt_secret(REAL_SECRET)) == REAL_SECRET


# ---------------------------------------------------------------------------
# Order creation: no silent downgrade to a fake successful order
# ---------------------------------------------------------------------------

def test_order_creation_refuses_unconfigured_admin_when_simulation_off(monkeypatch):
    monkeypatch.setattr(settings, "PAYMENTS_ALLOW_SIMULATION", False)
    with pytest.raises(RazorpayConfigurationError):
        asyncio.run(create_razorpay_order(
            key_id="rzp_test_simulated_key",
            encrypted_key_secret="",
            amount_in_paise=50000,
            receipt="rcpt_test",
        ))


def test_order_creation_simulates_only_when_explicitly_enabled(monkeypatch):
    monkeypatch.setattr(settings, "PAYMENTS_ALLOW_SIMULATION", True)
    order = asyncio.run(create_razorpay_order(
        key_id="rzp_test_simulated_key",
        encrypted_key_secret="",
        amount_in_paise=50000,
        receipt="rcpt_test",
    ))
    assert order["simulated"] is True
    assert SIMULATED_PROVIDER == "razorpay_simulated"


def test_seeded_placeholder_secrets_are_not_treated_as_real_credentials(monkeypatch):
    """The demo seed secrets must never be mistaken for a configured merchant account."""
    monkeypatch.setattr(settings, "PAYMENTS_ALLOW_SIMULATION", False)
    for key_id, secret in [
        ("rzp_test_ameen_123456", "test_secret"),
        ("rzp_test_alex_987654", "secret_alex"),
    ]:
        with pytest.raises(RazorpayConfigurationError):
            asyncio.run(create_razorpay_order(
                key_id=key_id,
                encrypted_key_secret=encrypt_secret(secret),
                amount_in_paise=50000,
                receipt="rcpt_test",
            ))


# ---------------------------------------------------------------------------
# Password verification
# ---------------------------------------------------------------------------

def test_correct_password_verifies():
    assert verify_password("CorrectHorse1!", get_password_hash("CorrectHorse1!")) is True


def test_wrong_password_fails():
    assert verify_password("WrongPassword1!", get_password_hash("CorrectHorse1!")) is False


def test_plaintext_stored_password_never_authenticates():
    """
    Regression: verify_password once fell back to `plain == hashed` whenever bcrypt
    raised. A plaintext value in the password column would then authenticate on exact
    match. It must now fail, even though the strings are identical.
    """
    assert verify_password("admin123", "admin123") is False


@pytest.mark.parametrize(
    "bad_hash",
    [
        "",
        "not-a-hash",
        "$2b$12$tooshort",
        "$99$12$" + "x" * 53,          # unknown bcrypt variant
        "md5:5f4dcc3b5aa765d61d8327deb882cf99",
    ],
)
def test_malformed_hashes_fail_authentication(bad_hash):
    assert verify_password("anything", bad_hash) is False


def test_empty_password_fails_even_against_a_valid_hash():
    assert verify_password("", get_password_hash("CorrectHorse1!")) is False


def test_hashing_uses_bcrypt():
    """The project's intended algorithm, applied consistently."""
    hashed = get_password_hash("CorrectHorse1!")
    assert hashed.startswith("$2b$")
    assert bcrypt.checkpw(b"CorrectHorse1!", hashed.encode())


def test_hashes_are_salted_and_therefore_unique():
    assert get_password_hash("SamePassword1!") != get_password_hash("SamePassword1!")


def test_password_longer_than_bcrypt_limit_still_verifies():
    long_password = "A" * 200
    assert verify_password(long_password, get_password_hash(long_password)) is True
