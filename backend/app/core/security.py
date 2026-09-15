import base64
import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Union, Optional
import jwt
import bcrypt
from cryptography.fernet import Fernet
from app.core.config import settings

logger = logging.getLogger(__name__)


class SecretDecryptionError(RuntimeError):
    """Raised when a stored secret cannot be decrypted with the configured ENCRYPTION_KEY."""


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifies a password against its bcrypt hash.

    Fails closed: any malformed hash, wrong-type input, or unexpected bcrypt error
    results in authentication failure. There is deliberately no plaintext-comparison
    fallback -- a non-bcrypt value in the password column must never authenticate.
    """
    if not plain_password or not hashed_password:
        return False

    try:
        return bcrypt.checkpw(
            plain_password.encode('utf-8')[:72],
            hashed_password.encode('utf-8')
        )
    except Exception:
        # Malformed/legacy hash, or a bcrypt failure. Deny, and leave a trace so a
        # bad stored hash is diagnosable without leaking the credential itself.
        logger.warning("Password verification failed: stored hash is not valid bcrypt.")
        return False

def get_password_hash(password: str) -> str:
    # Truncate to 72 bytes per bcrypt standard
    pwd_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def create_access_token(subject: Union[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    # iat lets a credential change end sessions issued before it (deps.get_current_user).
    to_encode = {"exp": expire, "iat": int(datetime.now(timezone.utc).timestamp()), "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

# Symmetric encryption for Google OAuth refresh tokens and Razorpay Secrets at rest
def _get_fernet_key() -> bytes:
    digest = hashlib.sha256(settings.ENCRYPTION_KEY.encode()).digest()
    return base64.urlsafe_b64encode(digest)

def encrypt_secret(plain_text: str) -> str:
    if not plain_text:
        return ""
    f = Fernet(_get_fernet_key())
    return f.encrypt(plain_text.encode()).decode()

def decrypt_secret(cipher_text: str) -> str:
    """
    Decrypts a secret stored at rest.

    Fails closed: raises SecretDecryptionError rather than returning the ciphertext.
    Returning the raw ciphertext would silently hand callers a wrong secret -- for
    payment verification that turns a key-management fault into a signature mismatch
    that looks like a customer problem.
    """
    if not cipher_text:
        return ""
    try:
        f = Fernet(_get_fernet_key())
        return f.decrypt(cipher_text.encode()).decode()
    except Exception as exc:
        raise SecretDecryptionError(
            "Stored secret could not be decrypted with the configured ENCRYPTION_KEY. "
            "The key may have changed since the secret was saved."
        ) from exc

# --- Deleted-admin identity hashing -------------------------------------------------
# A permanently deleted admin leaves behind only a hash of their email, never the
# address itself (see models.DeletedAdminIdentity). Keyed with SECRET_KEY so the table
# cannot be brute-forced against a list of candidate addresses by anyone who obtains a
# database dump but not the application secret.

def normalize_email(email: str) -> str:
    """
    Canonical form used for every identity comparison.

    "  User@Example.COM " and "user@example.com" are the same person for the purposes of
    the re-registration block, so both must produce the same hash.
    """
    return (email or "").strip().lower()


def hash_email(email: str) -> str:
    """Deterministic keyed digest of the normalized email. Hex, 64 chars."""
    normalized = normalize_email(email)
    return hmac.new(
        settings.SECRET_KEY.encode(),
        normalized.encode(),
        hashlib.sha256,
    ).hexdigest()
