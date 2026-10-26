"""
Real Google Meet recording retrieval. IMPLEMENTED FROM GOOGLE'S DOCUMENTATION, NOT VERIFIED
AGAINST A LIVE ACCOUNT: nothing here has been run against Google, because it needs a Google
Workspace host with Meet recording enabled and the scopes below. It is exercised only by
mock-based tests and is inert until RECORDING_RETRIEVAL_ENABLED is turned on.

What it does:
  * scopes: the extra OAuth scopes, requested only from the Super Admin and only when
    RECORDING_SCOPES_ENABLED is on (see api/google_calendar.get_auth_url).
  * lookup(): Meet REST v2 conferenceRecords.list (filtered by the stored space), then
    conferenceRecords.recordings.list, mapped to one of our states. It never reports
    "available" unless Google lists a recording in state FILE_GENERATED with a Drive file.
  * stream tokens: short-lived HMAC-signed tokens so a <video> tag (which cannot send a bearer
    header) can play a recording through the backend without a public or permanent link.
  * open_drive_media(): opens the Drive file for streaming with the host's token. The token
    and the Drive URL never leave the backend.
"""
import hashlib
import hmac
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

MEET_API = "https://meet.googleapis.com/v2"
DRIVE_API = "https://www.googleapis.com/drive/v3"
TIMEOUT_SECONDS = 15.0

# Roughly how long Google needs to publish a recording after a meeting; past this with no
# recording listed we say so instead of waiting forever.
NO_RECORDING_AFTER_MINUTES = 15
# A conference record can take a little while to appear after the meeting ends.
NO_CONFERENCE_AFTER_MINUTES = 20

STREAM_TOKEN_TTL_SECONDS = 3600

PERMISSION_DETAIL = (
    "Google permission is missing. The Super Admin must reconnect Google and approve "
    "access to meeting recordings."
)


class RecordingTemporaryError(Exception):
    """A transient Google failure (429, 5xx, timeout). The poll leaves the row alone and retries."""


@dataclass
class RecordingLookup:
    # "unchanged" = Google told us nothing new (e.g. permission missing); keep the status.
    state: str  # pending | processing | available | unavailable | unchanged
    drive_file_id: Optional[str] = None
    recorded_at: Optional[datetime] = None
    detail: Optional[str] = None


# --- OAuth scopes ---------------------------------------------------------------------------

def recording_scopes() -> list[str]:
    return [
        "https://www.googleapis.com/auth/meetings.space.settings",
        "https://www.googleapis.com/auth/meetings.space.readonly",
        settings.RECORDING_DRIVE_SCOPE,
    ]


def recording_scopes_for(role: str) -> list[str]:
    """Extra scopes to request for this user: only the Super Admin, only when flagged on."""
    if settings.RECORDING_SCOPES_ENABLED and role == "super_admin":
        return recording_scopes()
    return []


# --- Meet lookup -----------------------------------------------------------------------------

def _parse_time(value: Optional[str]) -> Optional[datetime]:
    """Google RFC 3339 timestamp -> naive UTC (how the rest of the app stores times)."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _minutes_since(moment: Optional[datetime]) -> Optional[float]:
    if moment is None:
        return None
    return (datetime.now(timezone.utc).replace(tzinfo=None) - moment).total_seconds() / 60.0


async def _get(client: httpx.AsyncClient, url: str, token: str, params: Optional[dict] = None) -> httpx.Response:
    try:
        res = await client.get(url, headers={"Authorization": f"Bearer {token}"}, params=params)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        raise RecordingTemporaryError(f"Google request failed: {exc.__class__.__name__}") from exc
    if res.status_code == 429 or res.status_code >= 500:
        raise RecordingTemporaryError(f"Google returned HTTP {res.status_code}")
    return res


async def lookup(
    access_token: str,
    space_name: str,
    *,
    ended_minutes_ago: Optional[float] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> RecordingLookup:
    """
    Asks Google what happened in this Meet space. `ended_minutes_ago` is how long ago the
    booked meeting was scheduled to end (None if it has not ended yet).
    """
    owns = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
    try:
        res = await _get(client, f"{MEET_API}/conferenceRecords", access_token,
                         params={"filter": f'space.name="{space_name}"'})
        if res.status_code in (401, 403):
            return RecordingLookup("unchanged", detail=PERMISSION_DETAIL)
        if res.status_code != 200:
            return RecordingLookup("unchanged", detail=f"Google returned HTTP {res.status_code} for the meeting lookup.")

        records = res.json().get("conferenceRecords", []) or []
        if not records:
            if ended_minutes_ago is None or ended_minutes_ago < NO_CONFERENCE_AFTER_MINUTES:
                return RecordingLookup("pending", detail="Waiting for the meeting to take place.")
            return RecordingLookup("unavailable", detail="No meeting took place in this space, so nothing was recorded.")

        recordings: list[dict] = []
        for record in records:
            rres = await _get(client, f"{MEET_API}/{record['name']}/recordings", access_token)
            if rres.status_code in (401, 403):
                return RecordingLookup("unchanged", detail=PERMISSION_DETAIL)
            if rres.status_code != 200:
                return RecordingLookup("unchanged", detail=f"Google returned HTTP {rres.status_code} for the recording lookup.")
            recordings.extend(rres.json().get("recordings", []) or [])

        # Newest first, so a re-joined meeting resolves to its latest recording.
        recordings.sort(key=lambda r: r.get("startTime") or "", reverse=True)

        for rec in recordings:
            file_ref = (rec.get("driveDestination") or {}).get("file")
            if rec.get("state") == "FILE_GENERATED" and file_ref:
                return RecordingLookup(
                    "available", drive_file_id=file_ref.split("/")[-1],
                    recorded_at=_parse_time(rec.get("startTime")), detail=None,
                )
        # FILE_GENERATED without a Drive file reference means the file is not exposed yet, so it is
        # still processing; it must never be reported as available.
        if any(rec.get("state") in ("STARTED", "ENDED", "FILE_GENERATED") for rec in recordings):
            return RecordingLookup("processing", detail="Google is processing the recording.")

        # Conference(s) exist but Google lists no recording.
        if any(not r.get("endTime") for r in records):
            return RecordingLookup("pending", detail="The meeting is still in progress.")
        latest_end = max(filter(None, (_parse_time(r.get("endTime")) for r in records)), default=None)
        waited = _minutes_since(latest_end)
        if waited is not None and waited >= NO_RECORDING_AFTER_MINUTES:
            return RecordingLookup(
                "unavailable",
                detail="The meeting ended without a recording. Recording may not have started (the host must join for it to start).",
            )
        return RecordingLookup("pending", detail="Waiting for Google to report a recording.")
    finally:
        if owns:
            await client.aclose()


# --- Playback --------------------------------------------------------------------------------

async def open_drive_media(access_token: str, file_id: str, range_header: Optional[str] = None):
    """
    Opens the recording file for streaming. Returns (client, upstream_response); the caller
    must close both. Raises RecordingTemporaryError on transport failure.
    """
    client = httpx.AsyncClient(timeout=None)
    headers = {"Authorization": f"Bearer {access_token}"}
    if range_header:
        headers["Range"] = range_header
    try:
        request = client.build_request("GET", f"{DRIVE_API}/files/{file_id}", params={"alt": "media"}, headers=headers)
        upstream = await client.send(request, stream=True)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        await client.aclose()
        raise RecordingTemporaryError(f"Drive request failed: {exc.__class__.__name__}") from exc
    return client, upstream


# --- Signed stream tokens ---------------------------------------------------------------------

def _sign_stream(student_id: str, booking_id: str, exp: int) -> str:
    msg = f"stream:{student_id}.{booking_id}.{exp}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()


def make_stream_token(student_id: str, booking_id: str, ttl: int = STREAM_TOKEN_TTL_SECONDS, now: Optional[int] = None) -> str:
    exp = int(now if now is not None else time.time()) + ttl
    return f"{student_id}.{booking_id}.{exp}.{_sign_stream(student_id, booking_id, exp)}"


def verify_stream_token(token: str, booking_id: str, now: Optional[int] = None) -> str:
    """The student id a valid token was issued to, or "" if forged, expired or for another booking."""
    parts = (token or "").split(".")
    if len(parts) != 4:
        return ""
    student_id, token_booking, exp_raw, signature = parts
    try:
        exp = int(exp_raw)
    except ValueError:
        return ""
    if token_booking != booking_id:
        return ""
    if not hmac.compare_digest(signature, _sign_stream(student_id, token_booking, exp)):
        return ""
    if int(now if now is not None else time.time()) > exp:
        return ""
    return student_id
