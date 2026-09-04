import hmac
import hashlib
import logging
import httpx
from app.core.config import settings
from app.core.security import decrypt_secret

logger = logging.getLogger(__name__)

# Provider value written to Payment.provider for orders created without a real gateway.
# Verification consults this stored server-side value -- never a client-supplied string.
SIMULATED_PROVIDER = "razorpay_simulated"
REAL_PROVIDER = "razorpay"


class RazorpayConfigurationError(RuntimeError):
    """The admin has no usable Razorpay credentials and simulation is disabled."""


class RazorpayOrderError(RuntimeError):
    """Razorpay rejected the order, or was unreachable."""


def _has_usable_credentials(key_id: str, secret: str) -> bool:
    """
    True only when both halves of a real per-admin credential pair are present.

    The seeded demo admins carry placeholder secrets; those are treated as absent so a
    demo install cannot accidentally look like a configured merchant.
    """
    if not key_id or not secret:
        return False
    if key_id.startswith("rzp_test_dummy") or key_id == "rzp_test_simulated_key":
        return False
    if secret == "test_secret" or secret.startswith("secret_"):
        return False
    return True


async def create_razorpay_order(
    key_id: str,
    encrypted_key_secret: str,
    amount_in_paise: int,
    currency: str = "INR",
    receipt: str = "rcpt"
) -> dict:
    """
    Creates an order with Razorpay using the specific Admin's own Key ID and Secret.

    Returns a dict with the order plus a "simulated" flag telling the caller which
    provider to record. Never silently downgrades a real gateway failure into a fake
    successful order -- a network or credential fault raises RazorpayOrderError so the
    booking stays unpaid instead of becoming confirmable without a real payment.
    """
    secret = decrypt_secret(encrypted_key_secret)

    if not _has_usable_credentials(key_id, secret):
        if not settings.PAYMENTS_ALLOW_SIMULATION:
            raise RazorpayConfigurationError(
                "This host has not connected a Razorpay account yet, so payments cannot be accepted."
            )
        logger.warning(
            "Creating SIMULATED Razorpay order for receipt %s -- "
            "PAYMENTS_ALLOW_SIMULATION is on. No real payment will be taken.",
            receipt,
        )
        return {
            "id": f"order_sim_{receipt}",
            "amount": amount_in_paise,
            "currency": currency,
            "status": "created",
            "simulated": True,
        }

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.razorpay.com/v1/orders",
                auth=(key_id, secret),
                json={
                    "amount": amount_in_paise,
                    "currency": currency,
                    "receipt": receipt,
                    "payment_capture": 1
                },
                timeout=10.0
            )
    except httpx.HTTPError as exc:
        logger.error("Razorpay order request failed for receipt %s: %s", receipt, exc)
        raise RazorpayOrderError("Could not reach the payment gateway. Please try again.") from exc

    if res.status_code not in (200, 201):
        # Log the gateway's reason server-side; do not surface it to the client.
        logger.error("Razorpay order creation rejected (%s): %s", res.status_code, res.text)
        raise RazorpayOrderError("The payment gateway rejected this order.")

    order = res.json()
    order["simulated"] = False
    return order


def verify_razorpay_signature(
    encrypted_key_secret: str,
    order_id: str,
    payment_id: str,
    signature: str
) -> bool:
    """
    Verifies a Razorpay payment signature server-side using Razorpay's documented
    algorithm: HMAC-SHA256 over "<order_id>|<payment_id>" keyed with that specific
    admin's key secret, compared in constant time. Byte-identical to the official
    SDK's razorpay.Utility.verify_payment_signature.

    Fails closed. There is no simulation bypass and no path that returns True without
    a matching HMAC -- the caller decides separately whether a payment was simulated,
    based on server-side database state.

    Raises SecretDecryptionError if the stored secret cannot be decrypted; that is a
    server key-management fault, not a bad signature, and must not be reported as one.
    """
    if not order_id or not payment_id or not signature:
        return False

    secret = decrypt_secret(encrypted_key_secret)
    if not secret:
        logger.error("Signature verification attempted for an admin with no stored Razorpay secret.")
        return False

    generated_signature = hmac.new(
        secret.encode(),
        f"{order_id}|{payment_id}".encode(),
        hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(generated_signature, signature)


class RazorpayCredentialStatus:
    """Outcome of a read-only credential check. Never mutates a stored connection."""

    def __init__(self, healthy: bool, *, reason: str | None = None, permanent: bool = False):
        self.healthy = healthy
        self.reason = reason
        # True only when Razorpay itself said the credentials are wrong (401/403). A network
        # error or a 5xx is temporary and must never be reported as "your keys are invalid".
        self.permanent = permanent


async def check_razorpay_credentials(key_id: str, encrypted_key_secret: str) -> RazorpayCredentialStatus:
    """
    Asks Razorpay whether the stored credentials still work, without creating anything.

    Read-only by construction: it lists at most one existing payment. The caller reports the
    result; nothing here writes to the database, so a failing check can never disconnect an
    admin's account.
    """
    try:
        secret = decrypt_secret(encrypted_key_secret)
    except Exception as exc:                                    # noqa: BLE001 - reported, not raised
        logger.error("Cannot decrypt stored Razorpay secret: %s", exc)
        return RazorpayCredentialStatus(
            False,
            reason="The stored key secret could not be read on this server.",
        )

    if not _has_usable_credentials(key_id, secret):
        return RazorpayCredentialStatus(
            False,
            reason="These credentials are placeholders, not a real Razorpay key pair.",
            permanent=True,
        )

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                "https://api.razorpay.com/v1/payments",
                auth=(key_id, secret),
                params={"count": 1},
                timeout=10.0,
            )
    except httpx.HTTPError as exc:
        logger.warning("Razorpay credential check could not reach the gateway: %s", exc)
        return RazorpayCredentialStatus(
            False,
            reason="Could not reach Razorpay to check these keys. This is usually temporary.",
        )

    if res.status_code == 200:
        return RazorpayCredentialStatus(True)

    if res.status_code in (401, 403):
        return RazorpayCredentialStatus(
            False,
            reason="Razorpay rejected these keys. They may have been regenerated or revoked.",
            permanent=True,
        )

    logger.warning("Razorpay credential check returned %s", res.status_code)
    return RazorpayCredentialStatus(
        False,
        reason="Razorpay did not answer the check. This is usually temporary.",
    )
