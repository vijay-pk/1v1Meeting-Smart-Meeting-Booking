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


async def refresh_google_token(encrypted_refresh_token: str) -> str:
    """Refreshes access token using stored encrypted refresh token."""
    refresh_token = decrypt_secret(encrypted_refresh_token)
    if not refresh_token:
        raise ValueError("Invalid refresh token")

    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        logger.warning("Google Client ID or Secret not configured. Using simulated access token.")
        return "simulated-access-token"

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
            logger.error(f"Failed to refresh Google token: {data}")
            raise RuntimeError(data.get("error_description", "Failed to refresh token"))
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
    """
    try:
        access_token = await refresh_google_token(encrypted_refresh_token)
    except Exception as e:
        logger.error(f"Google token refresh failed: {e}")
        raise GoogleCalendarUnavailable(str(e)) from e

    if access_token == "simulated-access-token":
        # No OAuth client configured, or a mock connection: there is no calendar to read.
        raise GoogleCalendarUnavailable("Google OAuth is not configured on this server")

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://www.googleapis.com/calendar/v3/freeBusy",
                headers={"Authorization": f"Bearer {access_token}"},
                json={
                    "timeMin": start_iso,
                    "timeMax": end_iso,
                    "items": [{"id": calendar_id or "primary"}]
                },
                timeout=10.0
            )
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
    return cal.get("busy", [])

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
) -> dict:
    """
    Creates an event on the Admin's Google Calendar with Google Meet conference data
    and configured 1-hour and 5-minute reminders.

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
            # sendUpdates=all is what puts the meeting on the CLIENT's calendar.
            #
            # There is no client account in this product -- bookings carry a name and an email,
            # not a user row -- so a client cannot connect a calendar of their own, and there
            # is nothing to write a second event into. The single shared event, created by the
            # host with the client as an attendee, is the only mechanism available and is also
            # the one that cannot drift: one event, one link, one time, both calendars.
            #
            # The API defaults sendUpdates to "none". The client was therefore listed as an
            # attendee and never told, so the meeting never reached their calendar. That is
            # the whole of the missing-client-calendar bug.
            "?conferenceDataVersion=1&sendUpdates=all"
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
            "conferenceData": {
                "createRequest": {
                    # Derived from the booking, not the clock. Google treats requestId as an
                    # idempotency key: a retry with the same id returns the conference that
                    # already exists instead of minting a second Meet link for one booking.
                    "requestId": idempotency_key or f"req_{int(datetime.now().timestamp())}",
                    "conferenceSolutionKey": {"type": "hangoutsMeet"}
                }
            },
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
                return {
                    "event_id": data.get("id"),
                    "meet_link": meet_link,
                    "html_link": data.get("htmlLink")
                }
            else:
                logger.error(f"Google Calendar event creation failed: {data}")
                return {"event_id": None, "meet_link": None, "html_link": None, "error": "api_error"}
    except Exception as e:
        logger.error(f"Exception creating Google Calendar event: {e}")
        return {"event_id": None, "meet_link": None, "html_link": None, "error": "exception"}
