"""
Strict Google Meet conference termination at scheduled end + 3 minutes.

Nothing here runs in a browser. The booking's stored start/end are authoritative; when someone
joins never moves the deadline.

    scheduled_end  = booking end_time (business-timezone wall clock -> UTC)
    termination_at = scheduled_end + GRACE_PERIOD_MINUTES

Termination uses the Google Meet REST API v2 with the host's own OAuth credentials and scope
https://www.googleapis.com/auth/meetings.space.created (spaces this app created):

    GET  https://meet.googleapis.com/v2/spaces/{id}                      is a conference active?
    POST https://meet.googleapis.com/v2/spaces/{id}:endActiveConference  end it

The end call is only made when the GET shows an active conference. Nothing is reported as ended
unless Google accepted the call (or the GET proved nothing was active, recorded honestly as
`no_active_conference`).

The job is a set of columns on `bookings`, so it survives restarts and deploys:

    termination_status   pending | retry | terminating | completed | no_active_conference |
                         failed | cancelled | not_applicable
    termination_due_at   the deadline (naive UTC)
    termination_generation  bumped whenever the job is (re)scheduled or cancelled; a worker
                         holding a stale claim cannot write its result over a newer job.

Workers claim a job with a conditional UPDATE, so two workers (in-process loop and the cron
endpoint, or two instances) can never both act on it.
"""
import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.models import Booking, GoogleConnection, MeetingTerminationAttempt, Notification, User
from app.services.google_calendar import refresh_google_token

logger = logging.getLogger(__name__)

BUSINESS_TZ = ZoneInfo(settings.BUSINESS_TIMEZONE)

# Minutes after the scheduled end before the conference is terminated. One rule for every
# booking: client, Admin, Super Admin, free and paid student.
GRACE_PERIOD_MINUTES = 3

MEET_API_BASE = "https://meet.googleapis.com/v2"
REQUEST_TIMEOUT_SECONDS = 15.0

# Bounded exponential backoff between attempts on transient failures (seconds). When the list
# is exhausted the job is marked failed rather than retried forever.
RETRY_BACKOFF_SECONDS = (30, 60, 120, 240, 480, 900)
# A claim older than this belongs to a worker that died mid-call; the job is made claimable again.
STALE_CLAIM_MINUTES = 10

# Test seam: tests set this to an httpx.MockTransport. None = real network.
_http_transport: Optional[httpx.AsyncBaseTransport] = None

TERMINAL_ENDED = ("completed", "no_active_conference")
OPEN_STATES = ("pending", "retry")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _wall_to_utc(value: str) -> Optional[datetime]:
    """
    Stored booking times are wall clock in BUSINESS_TIMEZONE with a cosmetic trailing "Z", so
    "2026-10-15T11:00:00Z" means 11:00 business time, not 11:00 UTC. Returns naive UTC.
    """
    if not value:
        return None
    cleaned = value.replace("Z", "").replace("+00:00", "")
    try:
        wall = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    return wall.replace(tzinfo=BUSINESS_TZ).astimezone(timezone.utc).replace(tzinfo=None)


def booking_end_utc(end_time: str) -> Optional[datetime]:
    return _wall_to_utc(end_time)


def booking_start_utc(start_time: str) -> Optional[datetime]:
    return _wall_to_utc(start_time)


def booking_termination_utc(end_time: str) -> Optional[datetime]:
    """Authoritative termination deadline: scheduled end + GRACE_PERIOD_MINUTES (naive UTC)."""
    end_utc = booking_end_utc(end_time)
    if end_utc is None:
        return None
    return end_utc + timedelta(minutes=GRACE_PERIOD_MINUTES)


def format_localized_termination_time(end_time: str, tz_name: Optional[str] = None) -> str:
    """Termination time in the booking's timezone, e.g. '3:23 PM'."""
    term_utc = booking_termination_utc(end_time)
    if not term_utc:
        return f"in {GRACE_PERIOD_MINUTES} minutes"
    try:
        tz = ZoneInfo(tz_name or settings.BUSINESS_TIMEZONE)
    except Exception:
        tz = BUSINESS_TZ
    localized = term_utc.replace(tzinfo=timezone.utc).astimezone(tz)
    hour = localized.strftime("%I").lstrip("0") or "12"
    return f"{hour}:{localized.strftime('%M %p')}"


def iso_utc(value: Optional[datetime]) -> Optional[str]:
    """ISO-8601 UTC with an explicit Z, for API responses (clients never guess the zone)."""
    if value is None:
        return None
    return value.replace(tzinfo=None).isoformat(timespec="seconds") + "Z"


# --------------------------------------------------------------------------------------
# Job state: schedule / cancel / phase
# --------------------------------------------------------------------------------------

def schedule_termination_job(booking: Booking) -> None:
    """
    (Re)schedules the termination job from the booking's current end_time. Called when a
    booking is confirmed and whenever it is rescheduled. Bumps the generation so any worker
    still holding a claim on the previous schedule cannot write its result. Does not commit.
    """
    booking.termination_generation = (booking.termination_generation or 0) + 1
    booking.termination_claimed_at = None
    booking.termination_next_attempt_at = None
    booking.termination_retries = 0
    booking.termination_error = None
    booking.termination_last_http_status = None
    booking.terminated_at = None
    booking.grace_notified_at = None
    booking.completed_at = None
    if booking.status != "confirmed" or not (booking.google_meet_link or booking.google_meet_space_id):
        booking.termination_status = "not_applicable"
        booking.termination_due_at = None
        return
    booking.termination_due_at = booking_termination_utc(booking.end_time)
    booking.termination_status = "pending" if booking.termination_due_at else "not_applicable"


def cancel_termination_job(booking: Booking) -> None:
    """Cancels the job (booking cancelled/deleted). Bumps the generation. Does not commit."""
    booking.termination_generation = (booking.termination_generation or 0) + 1
    booking.termination_claimed_at = None
    booking.termination_next_attempt_at = None
    if booking.termination_status not in TERMINAL_ENDED:
        booking.termination_status = "cancelled"


def meeting_phase(booking: Booking, now: Optional[datetime] = None) -> str:
    """
    UI status, derived from stored facts only (the browser never decides it):
    scheduled | in_progress | termination_pending | ended | termination_failed | cancelled
    """
    now = now or _utc_now()
    if booking.status == "cancelled":
        return "cancelled"
    if booking.termination_status in TERMINAL_ENDED:
        return "ended"
    if booking.termination_status == "failed":
        return "termination_failed"
    start = booking_start_utc(booking.start_time)
    end = booking_end_utc(booking.end_time)
    if start and now < start:
        return "scheduled"
    if end and now < end:
        return "in_progress"
    has_meet = bool(booking.google_meet_link or booking.google_meet_space_id)
    if not has_meet or booking.termination_status in ("not_applicable", "cancelled"):
        return "ended"
    return "termination_pending"


def lifecycle_status(booking: Booking, now: Optional[datetime] = None) -> str:
    """
    The booking's life as a person understands it, from stored facts and the scheduled end:
    cancelled | completed | upcoming (or the raw status for pending_payment / expired).
    `completed` means the SCHEDULED time is over. It says nothing about attendance and is
    independent of the Meet termination job, which still runs until end + grace.
    """
    now = now or _utc_now()
    if booking.status == "cancelled":
        return "cancelled"
    if booking.status == "confirmed":
        end = booking_end_utc(booking.end_time)
        if booking.completed_at is not None or (end is not None and now >= end):
            return "completed"
        return "upcoming"
    return booking.status


def phase_fields(booking: Booking, now: Optional[datetime] = None) -> dict:
    """The timing/phase block both the public booking page and the student list return."""
    now = now or _utc_now()
    from app.services.student_rules import change_info
    return {
        "meeting_phase": meeting_phase(booking, now),
        "lifecycle_status": lifecycle_status(booking, now),
        "scheduled_start_at": iso_utc(booking_start_utc(booking.start_time)),
        "scheduled_end_at": iso_utc(booking_end_utc(booking.end_time)),
        "termination_at": iso_utc(booking_termination_utc(booking.end_time)),
        "grace_minutes": GRACE_PERIOD_MINUTES,
        "server_now": iso_utc(now),
        **change_info(booking, now),
    }


# --------------------------------------------------------------------------------------
# Wrap-up notification at the scheduled end
# --------------------------------------------------------------------------------------

async def deliver_grace_period_notification(db: Session, booking: Booking) -> None:
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


# --------------------------------------------------------------------------------------
# Google Meet REST calls
# --------------------------------------------------------------------------------------

def parse_meet_space_name(space_id_or_link: Optional[str]) -> Optional[str]:
    """Normalises a space id / meeting URL / code into `spaces/{id_or_code}`."""
    if not space_id_or_link:
        return None
    val = space_id_or_link.strip()
    if val.startswith("spaces/"):
        return val
    m = re.search(r"meet\.google\.com/([a-zA-Z0-9-]+)", val)
    if m:
        return f"spaces/{m.group(1)}"
    cleaned = re.sub(r"[^a-zA-Z0-9-]", "", val)
    if cleaned:
        return f"spaces/{cleaned}"
    return None


def _meeting_code_from_link(link: Optional[str]) -> Optional[str]:
    if not link:
        return None
    m = re.search(r"meet\.google\.com/([a-zA-Z0-9-]+)", link)
    return m.group(1).lower() if m else None


def _google_error_message(res: httpx.Response) -> str:
    try:
        return str(res.json().get("error", {}).get("message") or "")[:200]
    except Exception:
        return (res.text or "")[:200]


class _GoogleResult:
    """Outcome of one Meet REST call, already classified."""

    def __init__(self, ok: bool, status: Optional[int] = None, data: Optional[dict] = None,
                 error: Optional[str] = None, transient: bool = False):
        self.ok = ok
        self.status = status
        self.data = data or {}
        self.error = error
        self.transient = transient


async def _meet_call(method: str, path: str, access_token: str) -> _GoogleResult:
    """One Meet v2 request. Never raises; network faults come back as transient results."""
    url = f"{MEET_API_BASE}/{path}"
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, transport=_http_transport) as client:
            if method == "GET":
                res = await client.get(url, headers=headers)
            else:
                res = await client.post(url, headers=headers, json={})
    except (httpx.TimeoutException, httpx.NetworkError) as exc:
        return _GoogleResult(False, None, error=f"Network error talking to Google Meet: {exc}", transient=True)
    except Exception as exc:
        return _GoogleResult(False, None, error=f"Unexpected error talking to Google Meet: {exc}")

    code = res.status_code
    if 200 <= code < 300:
        try:
            data = res.json() if res.content else {}
        except Exception:
            data = {}
        return _GoogleResult(True, code, data if isinstance(data, dict) else {})
    detail = _google_error_message(res)
    if code in (429, 500, 502, 503, 504):
        return _GoogleResult(False, code, error=f"Google Meet API {code} (temporary): {detail}", transient=True)
    if code == 401:
        return _GoogleResult(False, code, error="Google authorization expired or was revoked. Reconnect Google in Settings.")
    if code == 403:
        return _GoogleResult(
            False, code,
            error=("Google refused access to this meeting space (403). Reconnect Google in Settings and approve "
                   "Meet permissions (meetings.space.created); the Google Meet REST API must also be enabled "
                   f"in the Google Cloud project. {detail}").strip(),
        )
    if code == 404:
        return _GoogleResult(False, code, error="Google Meet space was not found (deleted or not created by this app).")
    return _GoogleResult(False, code, error=f"Google Meet API HTTP {code}: {detail}")


# --------------------------------------------------------------------------------------
# Terminating one booking
# --------------------------------------------------------------------------------------

def _finish(db: Session, booking_id: str, generation: int, values: dict) -> bool:
    """
    Writes a claim's result only if the job is still the one that was claimed: same
    generation and still `terminating`. A reschedule/cancel in between bumps the generation,
    so a stale result is dropped instead of overwriting the newer job.
    """
    updated = (
        db.query(Booking)
        .filter(
            Booking.id == booking_id,
            Booking.termination_generation == generation,
            Booking.termination_status == "terminating",
        )
        .update(values, synchronize_session=False)
    )
    db.commit()
    return updated == 1


async def terminate_booking_conference(db: Session, booking: Booking, now: Optional[datetime] = None) -> dict:
    """
    Ends the Meet conference of a claimed booking (status `terminating`). Isolated per host:
    uses only that admin's Google credentials. Returns {"status": ..., "detail": ...} with
    status completed | no_active_conference | retry | failed | cancelled | skipped.
    """
    bid = booking.id
    now = now or _utc_now()
    gen = booking.termination_generation or 0
    retries = booking.termination_retries or 0

    def record(outcome: str, http: Optional[int], detail: Optional[str]) -> None:
        db.add(MeetingTerminationAttempt(
            booking_id=bid, generation=gen, outcome=outcome, http_status=http,
            detail=(detail or "")[:500] or None,
        ))

    def settle(status: str, *, outcome: str, error: Optional[str] = None, http: Optional[int] = None,
               terminated: bool = False, next_at: Optional[datetime] = None,
               new_retries: Optional[int] = None, notify: Optional[tuple] = None) -> bool:
        values = {
            Booking.termination_status: status,
            Booking.termination_error: error,
            Booking.termination_last_http_status: http,
            Booking.termination_claimed_at: None,
            Booking.termination_next_attempt_at: next_at,
        }
        if terminated:
            values[Booking.terminated_at] = _utc_now()
        if new_retries is not None:
            values[Booking.termination_retries] = new_retries
        record(outcome, http, error)
        ok = _finish(db, bid, gen, values)
        if ok and notify:
            db.add(Notification(
                admin_id=booking.admin_id, type="termination_failed",
                title=notify[0], message=notify[1], booking_id=bid,
            ))
            db.commit()
        elif not ok:
            logger.info("Stale termination result dropped for booking %s (job was rescheduled or cancelled)", bid)
        return ok

    if booking.status == "cancelled":
        settle("cancelled", outcome="skipped", error="Booking was cancelled")
        return {"status": "cancelled", "detail": "Booking was cancelled"}

    if booking.status != "confirmed":
        settle("not_applicable", outcome="skipped", error=f"Booking status is {booking.status}")
        return {"status": "skipped", "detail": f"Booking status is {booking.status}"}

    if not booking.google_meet_link and not booking.google_meet_space_id:
        settle("not_applicable", outcome="skipped", error="No Google Meet link associated")
        return {"status": "skipped", "detail": "No Google Meet link associated"}

    host = db.query(User).filter(User.id == booking.admin_id).first()
    if not host or host.status != "ACTIVE":
        settle("failed", outcome="failed", error="Admin host is inactive or deleted")
        return {"status": "failed", "detail": "host_unavailable"}

    g_conn = (
        db.query(GoogleConnection)
        .filter(GoogleConnection.admin_id == host.id, GoogleConnection.connection_status == "connected")
        .first()
    )
    if not g_conn or not g_conn.encrypted_refresh_token:
        msg = "Host Google Calendar / Meet integration is disconnected"
        settle("failed", outcome="failed", error=msg, notify=(
            "Meeting Termination Alert",
            f"Could not end meeting with {booking.client_name}: Google account is disconnected. "
            "Please reconnect in Settings.",
        ))
        return {"status": "failed", "detail": "google_disconnected"}

    # Token refresh. Never flips connection_status: a failed refresh is reported, not acted on.
    try:
        access_token = await refresh_google_token(g_conn.encrypted_refresh_token)
    except (httpx.TimeoutException, httpx.NetworkError) as exc:
        return _retry_or_fail(settle, retries, f"Network error refreshing Google token: {exc}", None, now)
    except Exception as exc:
        logger.error("Failed to refresh Google token for host %s: %s", host.id, exc)
        msg = "Google authorization expired or was revoked. Reconnect Google in Settings."
        settle("failed", outcome="failed", error=msg, notify=(
            "Google Reconnection Required",
            "Google authorization expired or revoked, so a meeting could not be ended automatically. "
            "Please reconnect Google Calendar in Settings.",
        ))
        return {"status": "failed", "detail": "token_refresh_failed"}

    # Simulated OAuth (no Google client configured): nothing real to end.
    if access_token and access_token.startswith("simulated"):
        settle("completed", outcome="ended", error=None, terminated=True)
        return {"status": "completed", "detail": "simulated"}

    space_name = parse_meet_space_name(booking.google_meet_space_id or booking.google_meet_link)
    if not space_name:
        settle("failed", outcome="failed", error="Could not determine the Google Meet space for this booking")
        return {"status": "failed", "detail": "invalid_space_name"}

    # 1) Is a conference active? Never end blindly.
    got = await _meet_call("GET", space_name, access_token)
    if not got.ok:
        if got.transient:
            return _retry_or_fail(settle, retries, got.error, got.status, now)
        settle("failed", outcome="failed", error=got.error, http=got.status, notify=(
            "Meeting could not be ended automatically",
            f"Google rejected the request to end the meeting with {booking.client_name}: {got.error}",
        ) if got.status in (401, 403) else None)
        return {"status": "failed", "detail": got.error}

    # The space Google returned must be this booking's.
    link_code = _meeting_code_from_link(booking.google_meet_link)
    returned_code = str(got.data.get("meetingCode") or "").lower()
    if link_code and returned_code and link_code != returned_code:
        settle("failed", outcome="failed", http=got.status,
               error="Google returned a different meeting space than this booking's; nothing was ended.")
        return {"status": "failed", "detail": "space_mismatch"}
    canonical = got.data.get("name") or space_name

    if not got.data.get("activeConference"):
        settle("no_active_conference", outcome="no_active_conference", http=got.status, error=None)
        return {"status": "no_active_conference", "detail": "No active conference to end"}

    # 2) End it.
    ended = await _meet_call("POST", f"{canonical}:endActiveConference", access_token)
    if ended.ok:
        settle("completed", outcome="ended", http=ended.status, terminated=True, error=None)
        return {"status": "completed", "detail": "Conference ended"}
    if ended.status == 400:
        # FAILED_PRECONDITION: the conference ended between our GET and the end call.
        settle("no_active_conference", outcome="no_active_conference", http=ended.status, error=None)
        return {"status": "no_active_conference", "detail": "Conference had already ended"}
    if ended.transient:
        return _retry_or_fail(settle, retries, ended.error, ended.status, now)
    settle("failed", outcome="failed", error=ended.error, http=ended.status, notify=(
        "Meeting could not be ended automatically",
        f"Google rejected the request to end the meeting with {booking.client_name}: {ended.error}",
    ) if ended.status in (401, 403) else None)
    return {"status": "failed", "detail": ended.error}


def _retry_or_fail(settle, retries: int, error: Optional[str], http: Optional[int], now: datetime) -> dict:
    """Schedules the next attempt with exponential backoff, or fails once the schedule is spent."""
    if retries < len(RETRY_BACKOFF_SECONDS):
        next_at = now + timedelta(seconds=RETRY_BACKOFF_SECONDS[retries])
        settle("retry", outcome="retry", error=error, http=http, next_at=next_at, new_retries=retries + 1)
        return {"status": "retry", "retries": retries + 1, "detail": error}
    settle("failed", outcome="failed", error=f"Gave up after {retries} attempts: {error}", http=http,
           new_retries=retries, notify=(
               "Meeting could not be ended automatically",
               "Google could not be reached after several attempts, so a meeting was not ended automatically.",
           ))
    return {"status": "failed", "detail": error}


# --------------------------------------------------------------------------------------
# The sweep (worker loop and cron endpoint both call this)
# --------------------------------------------------------------------------------------

async def run_due_terminations(db: Session, now: Optional[datetime] = None) -> dict:
    """
    1. Wrap-up notification at the scheduled end (once, claimed on grace_notified_at).
    2. Terminate every job whose deadline (scheduled end + grace) has passed.

    Overdue jobs - after a restart, a deploy, or a long outage - are simply due: the next sweep
    runs them. Claims are conditional UPDATEs, so concurrent sweeps never double-process.
    """
    now = now or _utc_now()
    summary = {
        "scanned": 0, "notifications_sent": 0, "terminated": 0,
        "already_ended": 0, "retried": 0, "failed": 0, "skipped": 0,
    }

    # Recover claims abandoned by a worker that died mid-call.
    stale_before = now - timedelta(minutes=STALE_CLAIM_MINUTES)
    db.query(Booking).filter(
        Booking.termination_status == "terminating",
        Booking.termination_claimed_at.isnot(None),
        Booking.termination_claimed_at < stale_before,
    ).update({Booking.termination_status: "retry", Booking.termination_claimed_at: None},
             synchronize_session=False)
    db.commit()

    # --- Phase 0: persist "the scheduled time is over" ---
    # Only a marker (completed_at). status, attendance and the termination job are untouched, so
    # the Meet is still ended at scheduled end + grace and a termination failure stays visible.
    ended_candidates = (
        db.query(Booking)
        .filter(Booking.status == "confirmed", Booking.completed_at.is_(None))
        .order_by(Booking.end_time.asc())
        .limit(200)
        .all()
    )
    for booking in ended_candidates:
        end_utc = booking_end_utc(booking.end_time)
        if end_utc is None or end_utc > now:
            continue
        db.query(Booking).filter(Booking.id == booking.id, Booking.completed_at.is_(None)).update(
            {Booking.completed_at: end_utc}, synchronize_session=False)
    db.commit()

    # --- Phase 1: wrap-up notification at the scheduled end ---
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
            continue
        claimed = (
            db.query(Booking)
            .filter(Booking.id == booking.id, Booking.grace_notified_at.is_(None), Booking.status == "confirmed")
            .update({Booking.grace_notified_at: now}, synchronize_session=False)
        )
        db.commit()
        if claimed != 1:
            continue
        db.refresh(booking)
        await deliver_grace_period_notification(db, booking)
        summary["notifications_sent"] += 1

    # --- Phase 2: termination at scheduled end + grace ---
    candidates = (
        db.query(Booking)
        .filter(
            or_(Booking.google_meet_link.isnot(None), Booking.google_meet_space_id.isnot(None)),
            Booking.termination_status.in_(OPEN_STATES),
            or_(Booking.termination_due_at.is_(None), Booking.termination_due_at <= now),
            or_(Booking.termination_next_attempt_at.is_(None), Booking.termination_next_attempt_at <= now),
        )
        .order_by(Booking.termination_due_at.asc(), Booking.end_time.asc())
        .limit(100)
        .all()
    )

    for booking in candidates:
        # The deadline is recomputed from the booking's own end_time, so a stored due date
        # that a path forgot to update can still never end a meeting early.
        term_utc = booking_termination_utc(booking.end_time)
        if term_utc is None:
            continue
        if term_utc > now:
            if booking.termination_due_at != term_utc:
                booking.termination_due_at = term_utc
                db.commit()
            continue

        summary["scanned"] += 1
        seen_generation = booking.termination_generation or 0
        claimed = (
            db.query(Booking)
            .filter(
                Booking.id == booking.id,
                Booking.termination_status.in_(OPEN_STATES),
                Booking.termination_generation == seen_generation,
            )
            .update(
                {Booking.termination_status: "terminating", Booking.termination_claimed_at: now},
                synchronize_session=False,
            )
        )
        db.commit()
        if claimed != 1:
            continue
        db.refresh(booking)

        # A student session that reached its end + grace counts as attended. For a FREE
        # session this consumes exactly one allowance (the count is derived from
        # attendance_status, so setting it once is idempotent); a Super Admin can correct it
        # to no_show. Done before the Google call so a Google outage cannot skip accounting.
        if (
            booking.category in ("student_free", "student_paid")
            and booking.status == "confirmed"
            and booking.attendance_status in (None, "pending")
        ):
            booking.attendance_status = "completed"
            db.commit()

        result = await terminate_booking_conference(db, booking, now)
        st = result.get("status")
        if st == "completed":
            summary["terminated"] += 1
        elif st == "no_active_conference":
            summary["already_ended"] += 1
        elif st == "retry":
            summary["retried"] += 1
        elif st == "failed":
            summary["failed"] += 1
        else:
            summary["skipped"] += 1

    return summary


async def termination_worker(stop_event: asyncio.Event) -> None:
    """Runs a sweep every settings.TERMINATION_POLL_SECONDS until stop_event is set."""
    logger.info("Meeting termination worker started (poll interval: %ds).", settings.TERMINATION_POLL_SECONDS)
    while not stop_event.is_set():
        try:
            db = SessionLocal()
            try:
                summary = await run_due_terminations(db)
                if summary["terminated"] or summary["failed"] or summary["already_ended"]:
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
