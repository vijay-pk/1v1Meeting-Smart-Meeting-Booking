"""
Verification of Supabase Auth tokens.

The browser runs the Google OAuth dance through Supabase Auth, which hands it an
access token. That token is the ONLY thing the client sends us -- the email and
name are always re-read from Supabase here, never taken from the request body, so
a caller cannot claim to be an address they do not control.

Verification goes through Supabase's own /auth/v1/user endpoint rather than local
JWT signature checking: it needs no shared JWT secret, and it reflects tokens that
were revoked after issue.
"""
import logging
import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Supabase's own timeout is well under this; the ceiling only guards a hung socket.
_REQUEST_TIMEOUT_SECONDS = 10.0


class SupabaseAuthError(Exception):
    """Raised when a Supabase access token cannot be verified."""


class SupabaseNotConfigured(SupabaseAuthError):
    """Raised when the backend has no Supabase credentials to verify against."""


def _api_key() -> str:
    # Either key authenticates the /auth/v1/user call. The anon key is preferred:
    # it is the least-privileged credential that works.
    return settings.SUPABASE_ANON_KEY or settings.SUPABASE_SERVICE_ROLE_KEY


async def verify_supabase_token(access_token: str) -> dict:
    """
    Resolves a Supabase access token to a verified identity.

    Returns a dict with "email", "name", "provider" and "email_verified".
    Raises SupabaseAuthError if the token is missing, rejected, or resolves to an
    account whose email Google has not verified.
    """
    if not access_token or not access_token.strip():
        raise SupabaseAuthError("No access token supplied.")

    base_url = (settings.SUPABASE_URL or "").rstrip("/")
    api_key = _api_key()
    if not base_url or not api_key:
        raise SupabaseNotConfigured(
            "Google sign-in is not configured on this server: SUPABASE_URL and "
            "SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required."
        )

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{base_url}/auth/v1/user",
                headers={
                    "Authorization": f"Bearer {access_token.strip()}",
                    "apikey": api_key,
                },
            )
    except httpx.HTTPError as exc:
        logger.error("Supabase token verification request failed: %s", exc)
        raise SupabaseAuthError("Could not reach the identity provider.") from exc

    if response.status_code != 200:
        # 401/403 here means the token is expired, revoked, or forged.
        logger.warning("Supabase rejected an access token (HTTP %s).", response.status_code)
        raise SupabaseAuthError("Your Google sign-in session is invalid or has expired.")

    payload = response.json()
    metadata = payload.get("user_metadata") or {}

    email = (payload.get("email") or "").strip().lower()
    if not email:
        raise SupabaseAuthError("The Google account did not return an email address.")

    # Accounts are matched by email, so an unverified address would let a caller
    # claim someone else's account. Supabase reports Google's verification state.
    email_verified = payload.get("email_confirmed_at") is not None or bool(
        metadata.get("email_verified")
    )
    if not email_verified:
        raise SupabaseAuthError("This Google account has no verified email address.")

    name = (
        metadata.get("full_name")
        or metadata.get("name")
        or email.split("@")[0]
    ).strip()

    return {
        "email": email,
        "name": name,
        "email_verified": True,
        "provider": (payload.get("app_metadata") or {}).get("provider", "google"),
        "avatar_url": metadata.get("avatar_url") or metadata.get("picture") or "",
    }
