"""
Supabase Storage: the persistent home for admin-uploaded profile media.

Why this exists: uploads used to be written to the server's own filesystem, which a container
host wipes on every deploy, and then to a bytes column in Postgres, which works but puts
multi-megabyte blobs in the same table space as the application's rows. Object storage is the
right place for objects; the database keeps the reference.

Talked to over plain HTTP with httpx rather than the `supabase` SDK, so this adds no
dependency to a project that already has httpx.

**The service-role key never leaves the server.** It is used here and nowhere else; the
frontend receives only the resulting public URL. Nothing in this module accepts a caller-
supplied path -- callers pass an admin id and a file, and the path is built here -- so there
is no traversal surface.
"""
import logging
import re
import uuid
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# One bucket, holding only public profile media. Nothing private is ever put here: the
# database, the encrypted credential columns and everything else stay where they are.
BUCKET = "profile-media"

REQUEST_TIMEOUT_SECONDS = 30.0

# Only formats a browser will render as an image, decided by the file's own bytes.
SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"GIF87a", "image/gif", ".gif"),
    (b"GIF89a", "image/gif", ".gif"),
)

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class SupabaseStorageNotConfigured(RuntimeError):
    """No usable Supabase Storage credentials on this server."""


class SupabaseStorageError(RuntimeError):
    """Supabase Storage refused or could not serve the request."""


def sniff_image_type(head: bytes) -> Optional[tuple]:
    """
    Identifies an image from its own leading bytes, returning (content_type, extension).

    The filename and the browser-supplied Content-Type are both attacker-controlled, so
    neither decides what a file is. WebP and AVIF are RIFF/ISO-BMFF containers, so they are
    matched on their brand rather than a fixed prefix.
    """
    if not head:
        return None
    for magic, content_type, ext in SIGNATURES:
        if head.startswith(magic):
            return content_type, ext
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", ".webp"
    # ISO base media: ....ftyp<brand>
    if head[4:8] == b"ftyp" and head[8:12] in (b"avif", b"avis"):
        return "image/avif", ".avif"
    return None


def is_configured() -> bool:
    return bool(settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY)


def _base_url() -> str:
    return (settings.SUPABASE_URL or "").rstrip("/")


def _headers(content_type: Optional[str] = None) -> dict:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def build_object_path(admin_id: str, extension: str) -> str:
    """
    `profile/{admin_id}/avatar/{uuid}{ext}`.

    Built entirely from values this server controls: a validated admin id, a fresh uuid, and
    an extension derived from the file's own magic bytes. The uploader's filename is never
    part of the path, so it cannot contain "..", a leading slash, or anything else.
    """
    if not _SAFE_ID.match(admin_id or ""):
        raise SupabaseStorageError("Invalid owner id for a storage path.")
    if not extension.startswith(".") or not extension[1:].isalnum():
        raise SupabaseStorageError("Invalid file extension for a storage path.")
    return f"profile/{admin_id}/avatar/{uuid.uuid4().hex}{extension}"


def public_url(object_path: str) -> str:
    """The stable public URL for an object in the public profile-media bucket."""
    return f"{_base_url()}/storage/v1/object/public/{BUCKET}/{object_path}"


async def ensure_bucket() -> None:
    """
    Creates the bucket if it is not there yet. Idempotent, and safe to call before an upload.

    Public on purpose: these are profile photos shown on a booking page that anyone with the
    host's link can open, and a public object URL needs no expiry handling and caches at the
    CDN. Only this bucket is public -- it holds nothing but profile media.
    """
    if not is_configured():
        raise SupabaseStorageNotConfigured(
            "Supabase Storage is not configured on this server."
        )

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        existing = await client.get(f"{_base_url()}/storage/v1/bucket/{BUCKET}", headers=_headers())
        if existing.status_code == 200:
            return
        created = await client.post(
            f"{_base_url()}/storage/v1/bucket",
            headers=_headers("application/json"),
            json={
                "id": BUCKET,
                "name": BUCKET,
                "public": True,
                "file_size_limit": 8 * 1024 * 1024,
                "allowed_mime_types": [
                    "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
                ],
            },
        )
        # 409 means someone else created it between the two calls, which is fine.
        if created.status_code not in (200, 201, 409):
            logger.error("Could not create bucket %s: %s %s", BUCKET, created.status_code, created.text)
            raise SupabaseStorageError(
                "Could not prepare the media bucket in Supabase Storage."
            )


async def upload_object(object_path: str, data: bytes, content_type: str) -> str:
    """Stores the bytes and returns their public URL. Never overwrites an existing object."""
    if not is_configured():
        raise SupabaseStorageNotConfigured(
            "Supabase Storage is not configured on this server."
        )

    await ensure_bucket()

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        res = await client.post(
            f"{_base_url()}/storage/v1/object/{BUCKET}/{object_path}",
            headers={
                **_headers(content_type),
                # Paths carry a fresh uuid, so a collision means something is wrong; fail
                # rather than silently replacing whatever is already there.
                "x-upsert": "false",
                "cache-control": "public, max-age=31536000, immutable",
            },
            content=data,
        )

    if res.status_code not in (200, 201):
        logger.error("Supabase Storage upload failed (%s): %s", res.status_code, res.text[:300])
        raise SupabaseStorageError("The file could not be stored. Please try again.")

    return public_url(object_path)


async def delete_object(object_path: str) -> None:
    """
    Best effort removal. A failure is logged, never raised: losing an orphaned object is a
    tidiness problem, while failing the caller (an account deletion, say) is a real one.
    """
    if not is_configured() or not object_path:
        return
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            await client.delete(
                f"{_base_url()}/storage/v1/object/{BUCKET}/{object_path}",
                headers=_headers(),
            )
    except Exception as exc:                                    # noqa: BLE001 - best effort
        logger.warning("Could not delete storage object %s: %s", object_path, exc)
