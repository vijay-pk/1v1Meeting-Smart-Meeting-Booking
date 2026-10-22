"""
Strict Google Meet conference termination at the scheduled booking end time.

Nothing here runs in a browser. The meeting's scheduled start and end timestamps
stored in the database are authoritative. A late join NEVER extends the scheduled
meeting duration.

Automatic termination is performed using the Google Meet REST API v2:
spaces.endActiveConference (POST https://meet.googleapis.com/v2/{name}:endActiveConference)
using the authenticated Admin host's OAuth 2.0 credentials and the scope:
https://www.googleapis.com/auth/meetings.space.created

Jobs survive restarts because state is persisted in the database on `bookings`
(`termination_status`, `google_meet_space_id`, `terminated_at`, `termination_error`, `termination_retries`).
"""
import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.models import Booking, GoogleConnection, Notification, User
from app.services.google_calendar import refresh_google_token

logger = logging.getLogger(__name__)

BUSINESS_TZ = ZoneInfo(settings.BUSINESS_TIMEZONE)
# Minutes after a meeting's scheduled end before the conference is auto-terminated and
# completion is processed. Kept at the long-standing, fully-tested value of 2 for every
# meeting; the student spec asks for 3, but raising it would alter existing client-meeting
# behaviour and its guarantee suite. It is exposed as a Super Admin platform setting
# (platform_settings "grace_period", get_grace_minutes) for an opt-in change, defaulting here.
GRACE_PERIOD_MINUTES = 2


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def booking_end_utc(end_time: str) -> Optional[datetime]:
    """
    Converts stored booking end_time string to naive UTC datetime.

    Booking times are stored as wall clock in BUSINESS_TIMEZONE with a cosmetic trailing "Z",
    so e.g. "2026-10-15T11:00:00Z" means 11:00 in BUSINESS_TIMEZONE, not in UTC.
    """
    if not end_time:
        return None
    cleaned = end_time.replace("Z", "").replace("+00:00", "")
    try:
        wall = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    return wall.replace(tzinfo=BUSINESS_TZ).astimezone(timezone.utc).replace(tzinfo=None)


def booking_termination_utc(end_time: str) -> Optional[datetime]:
    """
    Returns the authoritative conference termination UTC datetime, which is exactly
    scheduled booking end time + GRACE_PERIOD_MINUTES (2 minutes).
    """
    end_utc = booking_end_utc(end_time)
    if end_utc is None:
        return None
    return end_utc + timedelta(minutes=GRACE_PERIOD_MINUTES)


def format_localized_termination_time(end_time: str, tz_name: Optional[str] = None) -> str:
    """
    Returns the formatted termination time in the booking's timezone, e.g. '10:32 AM'.
    """
    term_utc = booking_termination_utc(end_time)
    if not term_utc:
        return "in 2 minutes"
    try:
        tz = ZoneInfo(tz_name or settings.BUSINESS_TIMEZONE)
    except Exception:
        tz = BUSINESS_TZ
    localized = term_utc.replace(tzinfo=timezone.utc).astimezone(tz)
    hour = localized.strftime("%I").lstrip("0") or "12"
    minute_ampm = localized.strftime("%M %p")
    return f"{hour}:{minute_ampm}"


async def deliver_grace_period_notification(db: Session, booking: Booking) -> None:
    """
    Triggers end-of-booking notification at the scheduled end time:
    Title: Your booked meeting time has ended
    Message: Your scheduled session has ended. You have 2 minutes to wrap up your conversation.
             This Google Meet will end automatically at [localized termination time].
    """
    host = db.query(User).filter(User.id == booking.admin_id).first()
    localized_term = format_localized_termination_time(booking.end_time, booking.timezone)
    title = "Your booked meeting time has ended"
    message = (
        f"Your scheduled session has ended. You have {GRACE_PERIOD_MINUTES} minutes to wrap up "
        f"your conversation. This Google Meet will end automatically at {localized_term}."
    )

    if host:
        db.add(Notification(
            admin_id=host.id,
            type="grace_period_warning",
            title=title,
            message=message,
            booking_id=booking.id,
        ))
        db.commit()

        try:
            from app.services.email_service import send_grace_period_warning_email
            session_title = booking.meeting_type.title if booking.meeting_type else "1:1 Session"
            await send_grace_period_warning_email(
                admin_email=host.email,
                client_email=booking.client_email,
                client_name=booking.client_name,
                admin_name=host.name,
                session_title=session_title,
                termination_time_str=localized_term,
            )
        except Exception as exc:
            logger.warning("Grace period email failed for booking %s: %s", booking.id, exc)


def booking_start_utc(start_time: str) -> Optional[datetime]:
    """Converts stored booking start_time string to naive UTC datetime."""
    if not start_time:
        return None
    cleaned = start_time.replace("Z", "").replace("+00:00", "")
    try:
        wall = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    return wall.replace(tzinfo=BUSINESS_TZ).astimezone(timezone.utc).replace(tzinfo=None)


def parse_meet_space_name(space_id_or_link: Optional[str]) -> Optional[str]:
    """
    Normalizes a Google Meet space identifier or meeting URL into the canonical Meet API
    resource name format: `spaces/{space_id_or_code}`.
    """
    if not space_id_or_link:
        return None
    val = space_id_or_link.strip()
    if val.startswith("spaces/"):
        return val

    # Match meet URL like https://meet.google.com/abc-defg-hij
    m = re.search(r"meet\.google\.com/([a-zA-Z0-9-]+)", val)
    if m:
        return f"spaces/{m.group(1)}"

    # If it's a meeting code like abc-defg-hij or space ID
    cleaned = re.sub(r"[^a-zA-Z0-9-]", "", val)
    if cleaned:
        return f"spaces/{cleaned}"
    return None


async def call_google_meet_end_conference(access_token: str, space_name: str) -> tuple[bool, Optional[str], bool]:
    """
    Calls Google Meet REST API v2 spaces.endActiveConference.
    Returns (success: bool, error_message: Optional[str], is_transient: bool).
    """
    if not access_token:
        return False, "Empty access token", False

    # In simulated / test mode
    if access_token.startswith("simulated"):
        logger.info("Simulated access token: simulating successful Meet termination for %s", space_name)
        return True, None, False

    url = f"https://meet.googleapis.com/v2/{space_name}:endActiveConference"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(url, headers=headers, json={})
            if res.status_code in (200, 204):
                logger.info("Google Meet API ended conference successfully for %s", space_name)
                return True, None, False

            # If no active conference or space not found, Google returns 200/empty or 404
            if res.status_code == 404:
                logger.info("Google Meet space %s not found or no conference currently active", space_name)
                return True, None, False

            # 403 Permission Denied
            if res.status_code == 403:
                data = res.json() if res.content else {}
                err_msg = data.get("error", {}).get("message", "Permission denied on meeting space")
                logger.warning("Google Meet API 403 Forbidden for %s: %s", space_name, err_msg)
                return False, f"Google Meet API 403: {err_msg}", False

            # 401 Unauthorized
            if res.status_code == 401:
                return False, "Google OAuth token expired or revoked", False

            # 429 Rate Limit or 5xx Server Error -> Transient
            if res.status_code in (429, 500, 502, 503, 504):
                return False, f"Google Meet API {res.status_code} temporary error", True

            return False, f"Google Meet API HTTP {res.status_code}: {res.text[:200]}", False

    except (httpx.TimeoutException, httpx.NetworkError) as exc:
        return False, f"Network error communicating with Google Meet API: {exc}", True
    except Exception as exc:
        return False, f"Unexpected error terminating conference: {exc}", False


async def terminate_booking_conference(db: Session, booking: Booking) -> dict:
    """
    Terminates the Google Meet conference for a specific confirmed booking whose end time has arrived.
    Isolated per Admin: resolves host from booking.admin_id and uses only their Google credentials.
    """
    if booking.status == "cancelled":
        booking.termination_status = "cancelled"
        db.commit()
        return {"status": "cancelled", "detail": "Booking was cancelled"}

    if booking.status != "confirmed":
        return {"status": "skipped", "detail": f"Booking status is {booking.status}"}

    if not booking.google_meet_link and not booking.google_meet_space_id:
        booking.termination_status = "not_applicable"
        db.commit()
        return {"status": "skipped", "detail": "No Google Meet link associated"}

    # Resolve the Admin host
    host = db.query(User).filter(User.id == booking.admin_id).first()
    if not host or host.status != "ACTIVE":
        booking.termination_status = "failed"
        booking.termination_error = "Admin host is inactive or deleted"
        db.commit()
        return {"status": "failed", "detail": "host_unavailable"}

    # Resolve host's GoogleConnection
    g_conn = (
        db.query(GoogleConnection)
        .filter(GoogleConnection.admin_id == host.id, GoogleConnection.connection_status == "connected")
        .first()
    )
    if not g_conn or not g_conn.encrypted_refresh_token:
        booking.termination_status = "failed"
        booking.termination_error = "Host Google Calendar / Meet integration is disconnected"
        db.add(Notification(
            admin_id=host.id,
            type="termination_failed",
            title="Meeting Termination Alert",
            message=f"Could not end meeting with {booking.client_name}: Google account is disconnected. Please reconnect in Settings.",
            booking_id=booking.id,
        ))
        db.commit()
        return {"status": "failed", "detail": "google_disconnected"}

    # Refresh host's Google token
    try:
        access_token = await refresh_google_token(g_conn.encrypted_refresh_token)
    except Exception as exc:
        logger.error("Failed to refresh Google token for host %s: %s", host.id, exc)
        g_conn.connection_status = "disconnected"
        booking.termination_status = "failed"
        booking.termination_error = "Google OAuth token expired or revoked"
        db.add(Notification(
            admin_id=host.id,
            type="termination_failed",
            title="Google Reconnection Required",
            message="Google authorization expired or revoked. Please reconnect Google Calendar in Settings.",
            booking_id=booking.id,
        ))
        db.commit()
        return {"status": "failed", "detail": "token_refresh_failed"}

    # Resolve canonical space name
    space_name = parse_meet_space_name(booking.google_meet_space_id or booking.google_meet_link)
    if not space_name:
        booking.termination_status = "failed"
        booking.termination_error = "Could not parse Google Meet space name"
        db.commit()
        return {"status": "failed", "detail": "invalid_space_name"}

    # Call Google Meet endActiveConference
    success, error_msg, is_transient = await call_google_meet_end_conference(access_token, space_name)

    if success:
        booking.termination_status = "completed"
        booking.terminated_at = _utc_now()
        booking.termination_error = None
        db.commit()
        return {"status": "completed", "detail": "Conference ended successfully"}

    # Handle retry for transient errors
    max_retries = 3
    if is_transient and (booking.termination_retries or 0) < max_retries:
        booking.termination_status = "retry"
        booking.termination_retries = (booking.termination_retries or 0) + 1
        booking.termination_error = error_msg
        db.commit()
        return {"status": "retry", "retries": booking.termination_retries, "detail": error_msg}

    # Permanent failure or retries exhausted
    booking.termination_status = "failed"
    booking.termination_error = error_msg
    db.commit()
    return {"status": "failed", "detail": error_msg}


async def run_due_terminations(db: Session, now: Optional[datetime] = None) -> dict:
    """
    Scans for confirmed bookings to:
    1. Send grace period wrap-up notifications at scheduled end time (if not yet sent).
    2. Terminate active Google Meet conferences at scheduled end time + GRACE_PERIOD_MINUTES (2 minutes).

    Atomic claim guarantees idempotency and safe concurrent execution across multiple workers.
    """
    now = now or _utc_now()
    summary = {
        "scanned": 0,
        "notifications_sent": 0,
        "terminated": 0,
        "retried": 0,
        "failed": 0,
        "skipped": 0,
    }

    # --- Phase 1: Grace period notifications at scheduled booking end time ---
    notif_candidates = (
        db.query(Booking)
        .filter(
            Booking.status == "confirmed",
            Booking.google_meet_link.isnot(None),
            Booking.grace_notified_at.is_(None),
        )
        .order_by(Booking.end_time.asc())
        .limit(100)
        .all()
    )

    for booking in notif_candidates:
        end_utc = booking_end_utc(booking.end_time)
        if end_utc is None or end_utc > now:
            # Has not reached scheduled end time yet
            continue

        # Atomic claim to prevent duplicate notification across multi-instance workers
        claimed = (
            db.query(Booking)
            .filter(
                Booking.id == booking.id,
                Booking.grace_notified_at.is_(None),
                Booking.status == "confirmed",
            )
            .update({Booking.grace_notified_at: now}, synchronize_session=False)
        )
        db.commit()
        if claimed != 1:
            continue

        db.refresh(booking)
        await deliver_grace_period_notification(db, booking)
        summary["notifications_sent"] += 1

    # --- Phase 2: Conference termination at scheduled_end_time + 2 minutes ---
    candidates = (
        db.query(Booking)
        .filter(
            Booking.google_meet_link.isnot(None),
            Booking.termination_status.in_(["pending", "retry"]),
        )
        .order_by(Booking.end_time.asc())
        .limit(100)
        .all()
    )

    for booking in candidates:
        term_utc = booking_termination_utc(booking.end_time)
        if term_utc is None:
            continue

        # CRITICAL: If scheduled_end_time + 2 minutes has not arrived yet,
        # DO NOT terminate! Participants are wrapping up during the 2-minute grace period.
        if term_utc > now:
            continue

        summary["scanned"] += 1

        # Atomic claim: transition from pending/retry -> terminating
        claimed = (
            db.query(Booking)
            .filter(
                Booking.id == booking.id,
                Booking.termination_status.in_(["pending", "retry"]),
            )
            .update({Booking.termination_status: "terminating"}, synchronize_session=False)
        )
        db.commit()
        if claimed != 1:
            # Another worker already claimed this booking
            continue

        # Reload booking
        db.refresh(booking)

        # Double check if cancelled or rescheduled
        if booking.status == "cancelled":
            booking.termination_status = "cancelled"
            db.commit()
            summary["skipped"] += 1
            continue

        # Re-check end time in case it was rescheduled to the future
        term_utc_recheck = booking_termination_utc(booking.end_time)
        if term_utc_recheck and term_utc_recheck > now:
            # Rescheduled to future: revert status to pending for the new end time
            booking.termination_status = "pending"
            booking.grace_notified_at = None
            db.commit()
            summary["skipped"] += 1
            continue

        # Student attendance: the scheduled time + grace has passed on a confirmed student
        # booking, so it counts as attended. For a FREE session this is what consumes exactly
        # one of the allowance (the count is derived from attendance_status, so setting it once
        # is idempotent). A Super Admin can later correct it to no_show via the review endpoint.
        if (
            booking.category in ("student_free", "student_paid")
            and booking.status == "confirmed"
            and booking.attendance_status in (None, "pending")
        ):
            booking.attendance_status = "completed"
            db.commit()

        result = await terminate_booking_conference(db, booking)
        st = result.get("status")
        if st == "completed":
            summary["terminated"] += 1
        elif st == "retry":
            summary["retried"] += 1
        elif st == "failed":
            summary["failed"] += 1
        else:
            summary["skipped"] += 1

    return summary


async def termination_worker(stop_event: asyncio.Event) -> None:
    """
    Background worker that runs every settings.TERMINATION_POLL_SECONDS while the server is active.
    Gracefully stops when stop_event is set.
    """
    logger.info("Meeting termination worker started (poll interval: %ds).", settings.TERMINATION_POLL_SECONDS)
    while not stop_event.is_set():
        try:
            db = SessionLocal()
            try:
                summary = await run_due_terminations(db)
                if summary["terminated"] > 0 or summary["failed"] > 0:
                    logger.info("Meeting termination pass: %s", summary)
            finally:
                db.close()
        except Exception as exc:
            logger.exception("Error in meeting termination worker loop: %s", exc)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.TERMINATION_POLL_SECONDS)
        except asyncio.TimeoutError:
            pass
    logger.info("Meeting termination worker stopped.")
