import hashlib
import re
import time
import uuid
import os
import json
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

import httpx
from app.core.config import settings
from app.core.security import decrypt_secret

logger = logging.getLogger(__name__)


class GoogleCalendarUnavailable(Exception):
    """
    The admin's Google Calendar could not be read.

    Raised instead of returning an empty busy list, because "no busy blocks" and "we could
    not ask" must not look the same to the slot engine: treating a dead token as a free day
    is exactly how a client books over a real personal event.
    """


# --- Speed: reuse what Google already told us -------------------------------------------------
#
# A slot request used to refresh the OAuth token and then query FreeBusy, both over brand-new HTTPS
# connections, on EVERY click -- and the next click did it all again. Two small in-process caches
# remove almost all of that. Neither ever stores an error, and a rejected token is dropped at once,
# so a revoked connection still fails closed (GoogleCalendarUnavailable), never "free".
#
# Keys are SHA-256 digests of the refresh token, never the token itself.
_TOKEN_SAFETY_SECONDS = 120          # refresh this long before Google says the token expires
_token_cache: dict = {}              # digest -> (access_token, monotonic expiry)
_busy_cache: dict = {}               # (digest, calendar_id, start_iso, end_iso) -> (busy list, monotonic expiry)
_BUSY_CACHE_MAX = 512


def _digest(refresh_token: str) -> str:
    return hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()


def clear_google_caches() -> None:
    """Drops every cached token and busy answer (used by tests and after disconnects)."""
    _token_cache.clear()
    _busy_cache.clear()


def forget_google_account(encrypted_refresh_token: str) -> None:
    """
    Forget everything cached for one connected account. Called whenever this server writes to that
    calendar (a new booking's event, a moved event) so the next availability read sees it, and when
    the connection is removed.
    """
    try:
        digest = _digest(decrypt_secret(encrypted_refresh_token))
    except Exception:  # noqa: BLE001 - an undecryptable token has nothing cached under it
        return
    _token_cache.pop(digest, None)
    for key in [k for k in _busy_cache if k[0] == digest]:
        _busy_cache.pop(key, None)


def forget_google_busy(encrypted_refresh_token: str) -> None:
    """Like forget_google_account but keeps the (still valid) access token: only the busy answers go."""
    try:
        digest = _digest(decrypt_secret(encrypted_refresh_token))
    except Exception:  # noqa: BLE001
        return
    for key in [k for k in _busy_cache if k[0] == digest]:
        _busy_cache.pop(key, None)


async def refresh_google_token(encrypted_refresh_token: str) -> str:
    """Refreshes access token using stored encrypted refresh token (reused until it nears expiry)."""
    refresh_token = decrypt_secret(encrypted_refresh_token)
    if not refresh_token:
        raise ValueError("Invalid refresh token")

    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        logger.warning("Google Client ID or Secret not configured. Using simulated access token.")
        return "simulated-access-token"

    digest = _digest(refresh_token)
    use_cache = settings.GOOGLE_TOKEN_CACHE_ENABLED
    if use_cache:
        cached = _token_cache.get(digest)
        if cached and cached[1] > time.monotonic():
            return cached[0]

    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=10.0
        )
        data = res.json()
        if res.status_code != 200:
            _token_cache.pop(digest, None)
            logger.error(f"Failed to refresh Google token: {data}")
            raise RuntimeError(data.get("error_description", "Failed to refresh token"))
        if use_cache:
            try:
                lifetime = max(60, int(data.get("expires_in", 3600)))
            except (TypeError, ValueError):
                lifetime = 3600
            _token_cache[digest] = (data["access_token"], time.monotonic() + max(30, lifetime - _TOKEN_SAFETY_SECONDS))
        return data["access_token"]


async def get_google_busy_intervals(
    encrypted_refresh_token: str,
    start_iso: str,
    end_iso: str,
    calendar_id: str = "primary"
) -> list:
    """
    Queries Google Calendar FreeBusy for busy intervals in the given range.

    Fails closed: every failure (dead refresh token, undecryptable ciphertext, unconfigured
    OAuth client, non-200, timeout) raises GoogleCalendarUnavailable. Returning [] here would
    tell the slot engine the admin is free all day.

    start_iso / end_iso must be real UTC instants, not wall clock stamped with "Z".

    Successful answers are reused for GOOGLE_FREEBUSY_CACHE_SECONDS (0 = off). Errors are never cached.
    """
    ttl = settings.GOOGLE_FREEBUSY_CACHE_SECONDS
    cache_key = None
    if ttl and ttl > 0:
        try:
            cache_key = (_digest(decrypt_secret(encrypted_refresh_token)), calendar_id or "primary", start_iso, end_iso)
        except Exception:  # noqa: BLE001 - undecryptable: fall through, the refresh below fails closed
            cache_key = None
        if cache_key:
            hit = _busy_cache.get(cache_key)
            if hit and hit[1] > time.monotonic():
                return [dict(b) for b in hit[0]]

    async def _query(access_token: str):
        async with httpx.AsyncClient() as client:
            return await client.post(
                "https://www.googleapis.com/calendar/v3/freeBusy",
                headers={"Authorization": f"Bearer {access_token}"},
                json={
                    "timeMin": start_iso,
                    "timeMax": end_iso,
                    "items": [{"id": calendar_id or "primary"}]
                },
                timeout=10.0
            )

    try:
        access_token = await refresh_google_token(encrypted_refresh_token)
    except Exception as e:
        logger.error(f"Google token refresh failed: {e}")
        raise GoogleCalendarUnavailable(str(e)) from e

    if access_token == "simulated-access-token":
        # No OAuth client configured, or a mock connection: there is no calendar to read.
        raise GoogleCalendarUnavailable("Google OAuth is not configured on this server")

    try:
        res = await _query(access_token)
        if res.status_code == 401:
            # A cached token Google no longer accepts (revoked, rotated): drop it and try once with a
            # fresh one. If the refresh itself fails the connection is dead and this raises below.
            forget_google_account(encrypted_refresh_token)
            access_token = await refresh_google_token(encrypted_refresh_token)
            res = await _query(access_token)
    except Exception as e:
        logger.error(f"Error fetching Google freeBusy: {e}")
        raise GoogleCalendarUnavailable(str(e)) from e

    if res.status_code != 200:
        logger.error(f"Google freeBusy returned {res.status_code}: {res.text[:300]}")
        raise GoogleCalendarUnavailable(f"Google FreeBusy HTTP {res.status_code}: {res.text[:250]}")

    data = res.json()
    cal = data.get("calendars", {}).get(calendar_id or "primary", {})
    if cal.get("errors"):
        logger.error(f"Google freeBusy calendar errors: {cal['errors']}")
        raise GoogleCalendarUnavailable(str(cal["errors"]))
    busy = cal.get("busy", [])
    if cache_key:
        if len(_busy_cache) >= _BUSY_CACHE_MAX:
            now = time.monotonic()
            for k in [k for k, v in _busy_cache.items() if v[1] <= now] or list(_busy_cache)[: _BUSY_CACHE_MAX // 4]:
                _busy_cache.pop(k, None)
        _busy_cache[cache_key] = ([dict(b) for b in busy], time.monotonic() + ttl)
    return busy

def _wall_clock(iso: str) -> str:
    """'2026-03-04T15:00:00Z' -> '2026-03-04T15:00:00' (drops the misleading UTC marker)."""
    return iso.replace("Z", "").replace("+00:00", "")


async def create_calendar_event_with_meet(
    encrypted_refresh_token: str,
    title: str,
    description: str,
    start_time_iso: str,
    end_time_iso: str,
    client_name: str,
    client_email: str,
    calendar_id: str = "primary",
    idempotency_key: Optional[str] = None,
    auto_record: bool = False,
) -> dict:
    """
    Creates an event on the Admin's Google Calendar with Google Meet conference data
    and configured 1-hour and 5-minute reminders.

    auto_record asks Google to record the meeting automatically
    (config.artifactConfig.recordingConfig.autoRecordingGeneration = ON on the space). It is
    only requested for student bookings. If Google refuses the setting -- for instance on an
    account that cannot record -- the space is created again without it so the booking and its
    Meet link still work, and the result says recording_configured=False. Not verified against
    a live account (see docs/RECORDING_SIMULATION.md).

    Never fabricates a meeting link. Every failure path returns meet_link=None plus an
    "error" key naming the cause; only a real conference entry point from Google produces a
    URL. A generic "https://meet.google.com/new" is worse than no link at all, because it
    looks like a working invitation and drops the client into an empty meeting.

    This function does not raise: the caller is a payment-verification path where the money
    has already moved, and a calendar outage must never fail a paid booking.
    """
    try:
        access_token = await refresh_google_token(encrypted_refresh_token)
        if access_token == "simulated-access-token":
            # Google OAuth is not configured on this server, so no event and no conference
            # exist. Returning a fabricated id and "meet.google.com/new" used to send a
            # paying client a link to Google's "start a new meeting" page -- a link to a
            # meeting their host is not in. Report the failure instead; the caller confirms
            # the booking (the money moved) and tells the client the link will follow.
            logger.warning("Google OAuth not configured -- no calendar event created")
            return {"event_id": None, "meet_link": None, "html_link": None, "error": "not_configured"}

        # Honour the calendar the admin actually selected. GoogleConnection.calendar_id has
        # existed all along, defaulting to "primary", and this was hardcoded past it -- an
        # admin who picked a different calendar had events land somewhere they were not
        # looking.
        target = quote(calendar_id or "primary", safe="")
        url = (
            f"https://www.googleapis.com/calendar/v3/calendars/{target}/events"
            # sendUpdates=none: Google does NOT email the attendees. Resend is the single email
            # channel for this product. Notifying attendees here (the previous behaviour) made
            # Google send the client and the host its own calendar invitation on top of the
            # Resend confirmation -- two emails per person, from two different senders -- which
            # is the duplicate-email bug. This call still creates the event on the HOST's
            # calendar (unaffected by sendUpdates); it only stops Google from notifying anyone.
            #
            # There is no client account in this product -- bookings carry a name and an email,
            # not a user row -- so the client has no Google Calendar of their own to write to.
            # Reaching it via a Google invitation is exactly the duplicate email removed here;
            # instead the client gets the Resend confirmation plus the "Add to Google Calendar"
            # and .ics options on the confirmation page. The client stays listed as an attendee
            # on the host's event, just not emailed by Google.
            "?conferenceDataVersion=1&sendUpdates=none"
        )
        space_name = None
        space_uri = None
        space_code = None
        recording_configured = False

        if access_token.startswith("simulated"):
            sim_code = f"sim-{uuid.uuid4().hex[:3]}-{uuid.uuid4().hex[:4]}-{uuid.uuid4().hex[:3]}"
            space_name = f"spaces/{sim_code}"
            space_uri = f"https://meet.google.com/{sim_code}"
            space_code = sim_code
        else:
            try:
                async with httpx.AsyncClient(timeout=8.0) as meet_client:
                    meet_headers = {
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    }
                    meet_url = "https://meet.googleapis.com/v2/spaces"
                    body = (
                        {"config": {"artifactConfig": {"recordingConfig": {"autoRecordingGeneration": "ON"}}}}
                        if auto_record else {}
                    )
                    m_res = await meet_client.post(meet_url, headers=meet_headers, json=body)
                    if auto_record and m_res.status_code not in (200, 201):
                        # Do not lose the booking over a recording setting: create the space
                        # plainly and report that recording is not configured.
                        logger.warning(
                            "Meet rejected the auto-recording config (HTTP %s); creating the space without it",
                            m_res.status_code,
                        )
                        m_res = await meet_client.post(meet_url, headers=meet_headers, json={})
                    elif auto_record:
                        recording_configured = True
                    if m_res.status_code in (200, 201):
                        m_data = m_res.json()
                        space_name = m_data.get("name")
                        space_uri = m_data.get("meetingUri")
                        space_code = m_data.get("meetingCode")
                        if recording_configured:
                            # If Google echoes the setting back and it is not ON, believe Google.
                            echoed = (((m_data.get("config") or {}).get("artifactConfig") or {})
                                      .get("recordingConfig") or {}).get("autoRecordingGeneration")
                            if echoed is not None and echoed != "ON":
                                recording_configured = False
                    else:
                        recording_configured = False
            except Exception as m_exc:
                logger.warning("Meet space pre-creation skipped or unavailable: %s", m_exc)

        conf_spec = (
            {
                "conferenceId": space_code,
                "conferenceSolution": {"key": {"type": "hangoutsMeet"}},
                "entryPoints": [
                    {"entryPointType": "video", "uri": space_uri, "label": space_uri}
                ]
            }
            if space_code and space_uri
            else {
                "createRequest": {
                    "requestId": idempotency_key or f"req_{int(datetime.now().timestamp())}",
                    "conferenceSolutionKey": {"type": "hangoutsMeet"}
                }
            }
        )

        payload = {
            "summary": title,
            "description": description,
            # Booking times are stored as business-timezone wall clock with a trailing "Z"
            # (see api/availability.py). Strip the false "Z" and name the real zone, so the
            # event lands at the hour the client picked instead of shifting by the offset.
            "start": {"dateTime": _wall_clock(start_time_iso), "timeZone": settings.BUSINESS_TIMEZONE},
            "end": {"dateTime": _wall_clock(end_time_iso), "timeZone": settings.BUSINESS_TIMEZONE},
            # needsAction, not accepted: Google delivers a real invitation the client can
            # accept, decline or propose a new time for. Marking it accepted on their behalf
            # asserts a response they never gave.
            "attendees": [
                {"email": client_email, "displayName": client_name, "responseStatus": "needsAction"}
            ],
            "guestsCanModify": False,
            "guestsCanInviteOthers": False,
            "guestsCanSeeOtherGuests": False,
            "conferenceData": conf_spec,
            "reminders": {
                "useDefault": False,
                "overrides": [
                    {"method": "popup", "minutes": 60},  # 1 hour before
                    {"method": "popup", "minutes": 5},   # 5 minutes before
                    {"method": "email", "minutes": 60}
                ]
            }
        }

        async with httpx.AsyncClient() as client:
            res = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=12.0
            )
            data = res.json()
            if res.status_code in (200, 201):
                meet_link = None
                conf_data = data.get("conferenceData", {})
                entry_points = conf_data.get("entryPoints", [])
                for ep in entry_points:
                    if ep.get("entryPointType") == "video":
                        meet_link = ep.get("uri")
                        break

                if not meet_link:
                    meet_link = data.get("hangoutLink")

                # meet_link stays None when Google created no conference: a fabricated
                # meet.google.com URL would be emailed to a paying client and resolve to
                # nothing. The caller decides what to do with a missing link.
                if not meet_link and space_uri:
                    meet_link = space_uri

                if not space_name and meet_link:
                    conf_id = conf_data.get("conferenceId")
                    if conf_id:
                        space_name = f"spaces/{conf_id}"
                    else:
                        m = re.search(r"meet\.google\.com/([a-zA-Z0-9-]+)", meet_link)
                        if m:
                            space_name = f"spaces/{m.group(1)}"

                return {
                    "event_id": data.get("id"),
                    "meet_link": meet_link,
                    "space_name": space_name,
                    "html_link": data.get("htmlLink"),
                    # True only when auto-recording was requested, Google accepted it, and a
                    # real space exists. Never true for bookings that did not ask for it.
                    "recording_configured": bool(auto_record and recording_configured and space_name),
                }
            else:
                logger.error(f"Google Calendar event creation failed: {data}")
                return {"event_id": None, "meet_link": None, "html_link": None, "error": "api_error"}
    except Exception as e:
        logger.error(f"Exception creating Google Calendar event: {e}")
        return {"event_id": None, "meet_link": None, "html_link": None, "error": "exception"}


async def update_calendar_event_time(
    encrypted_refresh_token: str,
    calendar_id: str,
    event_id: str,
    start_time_iso: str,
    end_time_iso: str,
) -> dict:
    """
    Moves an existing event to a new start/end, keeping the same Meet conference.

    Patches only the times, so the Google Meet link and attendees survive the reschedule --
    the host's event shifts rather than a new one being created. sendUpdates=none: the new
    time is announced by the Resend reschedule email (api/bookings.py), not by a second Google
    notification, keeping Resend the single email channel.

    Never raises, like create_calendar_event_with_meet: the reschedule has already been
    written when this runs, and a calendar outage must not undo it. Returns {"ok": bool,
    "error": str|None}.
    """
    try:
        access_token = await refresh_google_token(encrypted_refresh_token)
        if access_token == "simulated-access-token":
            return {"ok": False, "error": "not_configured"}

        target = quote(calendar_id or "primary", safe="")
        url = (
            f"https://www.googleapis.com/calendar/v3/calendars/{target}/events/"
            f"{quote(event_id, safe='')}?sendUpdates=none"
        )
        payload = {
            "start": {"dateTime": _wall_clock(start_time_iso), "timeZone": settings.BUSINESS_TIMEZONE},
            "end": {"dateTime": _wall_clock(end_time_iso), "timeZone": settings.BUSINESS_TIMEZONE},
        }
        async with httpx.AsyncClient() as client:
            res = await client.patch(
                url,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=12.0,
            )
            if res.status_code in (200, 201):
                return {"ok": True, "error": None}
            logger.error("Google Calendar event patch failed: %s %s", res.status_code, res.text[:300])
            return {"ok": False, "error": "api_error"}
    except Exception as e:  # noqa: BLE001
        logger.error("Exception patching Google Calendar event: %s", e)
        return {"ok": False, "error": "exception"}
