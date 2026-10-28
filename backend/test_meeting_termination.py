"""
Automatic Google Meet termination at scheduled end + 3 minutes.

Google is never contacted: the Meet REST API is replaced by an httpx.MockTransport (`FakeMeet`)
that behaves like spaces.get / spaces.endActiveConference, so these tests exercise the real
HTTP code path (URLs, auth header, status classification), not a stub of our own function.

Covers: the exact deadline (20-minute meeting at 3:00 PM ends at 3:23 PM), the conference
staying open through the grace period, overdue jobs after a restart, no end call when nothing is
active, cancel / reschedule, transient failures with backoff, permission errors, correct-space
only, concurrent sweeps, every booking category, and recordings left alone.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import decrypt_secret, encrypt_secret, get_password_hash
from app.main import app, seed_initial_data
from app.models.models import (
    AdminProfile, Booking, GoogleConnection, MeetingRecording, MeetingTerminationAttempt,
    Notification, Session as SessionModel, User,
)
from app.services import meeting_termination
from app.services.meeting_termination import (
    GRACE_PERIOD_MINUTES,
    RETRY_BACKOFF_SECONDS,
    booking_end_utc,
    booking_termination_utc,
    cancel_termination_job,
    format_localized_termination_time,
    meeting_phase,
    parse_meet_space_name,
    run_due_terminations,
    schedule_termination_job,
)

seed_initial_data()
client = TestClient(app)
BUSINESS_TZ = ZoneInfo(settings.BUSINESS_TIMEZONE)
PASSWORD = "TestPassw0rd!123"


# ---------------------------------------------------------------------------------------
# Fakes and fixtures
# ---------------------------------------------------------------------------------------

class FakeMeet:
    """A tiny stand-in for meet.googleapis.com/v2 behind httpx.MockTransport."""

    def __init__(self):
        self.spaces = {}      # id -> {"active": bool}
        self.log = []         # (method, space_id, authorization)
        self.fail = {}        # "GET"/"POST" -> list of statuses (or "timeout") consumed in order

    def add(self, code, active=True):
        self.spaces[code] = {"active": active}

    def calls(self, method=None):
        return [c for c in self.log if method is None or c[0] == method]

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path  # /v2/spaces/{id} or /v2/spaces/{id}:endActiveConference
        assert path.startswith("/v2/spaces/"), path
        tail = path[len("/v2/spaces/"):]
        space_id, _, action = tail.partition(":")
        self.log.append((request.method, space_id, request.headers.get("authorization")))

        queued = self.fail.get(request.method) or []
        if queued:
            nxt = queued.pop(0)
            if nxt == "timeout":
                raise httpx.ConnectTimeout("timed out")
            return httpx.Response(nxt, json={"error": {"message": f"injected {nxt}"}})

        space = self.spaces.get(space_id)
        if space is None:
            return httpx.Response(404, json={"error": {"message": "not found"}})
        if request.method == "GET":
            body = {"name": f"spaces/{space_id}", "meetingCode": space_id,
                    "meetingUri": f"https://meet.google.com/{space_id}"}
            if space["active"]:
                body["activeConference"] = {"conferenceRecord": "conferenceRecords/x"}
            return httpx.Response(200, json=body)
        assert action == "endActiveConference"
        if not space["active"]:
            return httpx.Response(400, json={"error": {"status": "FAILED_PRECONDITION", "message": "no active conference"}})
        space["active"] = False
        return httpx.Response(200, json={})


@pytest.fixture
def meet(monkeypatch):
    fake = FakeMeet()
    monkeypatch.setattr(meeting_termination, "_http_transport", httpx.MockTransport(fake.handler))
    return fake


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def mock_google_refresh(monkeypatch):
    async def fake_refresh(enc_token):
        return f"access-token-for-{decrypt_secret(enc_token)}"

    monkeypatch.setattr(meeting_termination, "refresh_google_token", fake_refresh)


@pytest.fixture
def tracked():
    ids = []
    yield ids
    session = SessionLocal()
    try:
        for user_id in ids:
            booking_ids = [b.id for b in session.query(Booking).filter(Booking.admin_id == user_id)]
            if booking_ids:
                session.query(MeetingTerminationAttempt).filter(
                    MeetingTerminationAttempt.booking_id.in_(booking_ids)).delete(synchronize_session=False)
                session.query(MeetingRecording).filter(
                    MeetingRecording.booking_id.in_(booking_ids)).delete(synchronize_session=False)
            session.query(GoogleConnection).filter(GoogleConnection.admin_id == user_id).delete(synchronize_session=False)
            session.query(Notification).filter(Notification.admin_id == user_id).delete(synchronize_session=False)
            if booking_ids:
                session.query(Booking).filter(Booking.id.in_(booking_ids)).delete(synchronize_session=False)
            session.query(SessionModel).filter(SessionModel.admin_id == user_id).delete(synchronize_session=False)
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _user_with_google(db, tracked, tag="term", role="admin"):
    uid = uuid.uuid4().hex[:8]
    user = User(
        name=f"Host {tag}", email=f"host_{tag}_{uid}@testdomain.com",
        password_hash=get_password_hash(PASSWORD), role=role, status="ACTIVE",
    )
    db.add(user)
    db.flush()
    db.add(AdminProfile(user_id=user.id, username=f"host{tag}{uid}"))
    db.add(GoogleConnection(
        admin_id=user.id, google_email=f"google_{uid}@gmail.com",
        encrypted_refresh_token=encrypt_secret(f"mock-refresh-{uid}"), connection_status="connected",
    ))
    db.commit()
    tracked.append(user.id)
    return user


def _wall(dt_utc: datetime) -> str:
    """UTC instant -> stored booking format (business-timezone wall clock with cosmetic Z)."""
    return dt_utc.replace(tzinfo=timezone.utc).astimezone(BUSINESS_TZ).strftime("%Y-%m-%dT%H:%M:00Z")


def _booking(db, host, start_utc, duration_minutes=30, status="confirmed", meet_code="abc-defg-hij",
             category="client"):
    end_utc = start_utc + timedelta(minutes=duration_minutes)
    session = SessionModel(admin_id=host.id, title="1v1 Session", duration_minutes=duration_minutes, price=50000)
    db.add(session)
    db.flush()
    b = Booking(
        public_id=f"BK-TRM-{uuid.uuid4().hex[:8].upper()}",
        admin_id=host.id, meeting_type_id=session.id,
        client_name="Test Client", client_email="client@example.com",
        start_time=_wall(start_utc), end_time=_wall(end_utc), status=status,
        payment_status="completed" if status == "confirmed" else "pending",
        google_meet_link=f"https://meet.google.com/{meet_code}",
        google_meet_space_id=f"spaces/{meet_code}",
        cancellation_token=uuid.uuid4().hex, category=category,
    )
    db.add(b)
    db.flush()
    schedule_termination_job(b)
    db.commit()
    return b


def _run(db, now):
    return asyncio.run(run_due_terminations(db, now=now))


T0 = datetime(2030, 5, 10, 10, 0, 0)  # naive UTC


# ---------------------------------------------------------------------------------------
# Deadline arithmetic
# ---------------------------------------------------------------------------------------

def test_grace_is_three_minutes():
    assert GRACE_PERIOD_MINUTES == 3


def test_twenty_minute_meeting_at_3pm_terminates_at_323pm():
    """3:00 PM business time + 20 minutes = 3:20 PM end; + 3 minutes = 3:23 PM."""
    start = "2030-06-15T15:00:00Z"
    end = "2030-06-15T15:20:00Z"
    assert format_localized_termination_time(end, "Asia/Kolkata") == "3:23 PM"
    assert booking_termination_utc(end) == booking_end_utc(end) + timedelta(minutes=3)
    # 15:23 IST is 09:53 UTC: stored/computed in UTC, shown in the business timezone.
    assert booking_termination_utc(end) == datetime(2030, 6, 15, 9, 53, 0)
    assert start < end


def test_parse_meet_space_name():
    assert parse_meet_space_name("spaces/ABC123XYZ") == "spaces/ABC123XYZ"
    assert parse_meet_space_name("https://meet.google.com/abc-defg-hij") == "spaces/abc-defg-hij"
    assert parse_meet_space_name("abc-defg-hij") == "spaces/abc-defg-hij"
    assert parse_meet_space_name("") is None
    assert parse_meet_space_name(None) is None


def test_schedule_stores_deadline_on_the_booking(db, tracked):
    host = _user_with_google(db, tracked, "sched")
    b = _booking(db, host, T0, duration_minutes=20)
    assert b.termination_status == "pending"
    assert b.termination_due_at == T0 + timedelta(minutes=20 + GRACE_PERIOD_MINUTES)


# ---------------------------------------------------------------------------------------
# Timing: the meeting stays open through the whole grace period
# ---------------------------------------------------------------------------------------

def test_stays_active_through_grace_then_ends_at_end_plus_three(db, tracked, meet):
    host = _user_with_google(db, tracked, "timing")
    booking = _booking(db, host, T0, duration_minutes=20)  # ends 10:20, terminates 10:23
    meet.add("abc-defg-hij")

    assert _run(db, T0 + timedelta(minutes=19))["notifications_sent"] == 0

    res = _run(db, T0 + timedelta(minutes=20))        # scheduled end: wrap-up notice only
    assert res["notifications_sent"] == 1 and res["terminated"] == 0
    for minute in (21, 22):                           # inside the grace period: still open
        assert _run(db, T0 + timedelta(minutes=minute))["terminated"] == 0
    assert meet.calls() == [] and meet.spaces["abc-defg-hij"]["active"]

    note = db.query(Notification).filter(
        Notification.booking_id == booking.id, Notification.type == "grace_period_warning").one()
    assert f"{GRACE_PERIOD_MINUTES} minutes to wrap up" in note.message

    res = _run(db, T0 + timedelta(minutes=23))        # end + 3 minutes: ended
    assert res["terminated"] == 1
    assert [c[0] for c in meet.calls()] == ["GET", "POST"]
    assert meet.spaces["abc-defg-hij"]["active"] is False
    db.refresh(booking)
    assert booking.termination_status == "completed" and booking.terminated_at is not None
    assert booking.termination_last_http_status == 200


def test_late_join_never_moves_the_deadline(db, tracked, meet):
    """Nothing in the sweep reads who joined or when: only stored times decide."""
    host = _user_with_google(db, tracked, "late")
    _booking(db, host, T0, duration_minutes=30)
    meet.add("abc-defg-hij")
    assert _run(db, T0 + timedelta(minutes=29))["terminated"] == 0
    assert _run(db, T0 + timedelta(minutes=32))["terminated"] == 0   # 30 + 3 = 33
    assert _run(db, T0 + timedelta(minutes=33))["terminated"] == 1


def test_uses_the_hosts_own_token_and_the_booking_space(db, tracked, meet):
    host = _user_with_google(db, tracked, "tok")
    _booking(db, host, T0, duration_minutes=30)
    meet.add("abc-defg-hij")
    _run(db, T0 + timedelta(minutes=33))
    secret = decrypt_secret(
        db.query(GoogleConnection).filter(GoogleConnection.admin_id == host.id).one().encrypted_refresh_token)
    assert {c[2] for c in meet.calls()} == {f"Bearer access-token-for-{secret}"}


# ---------------------------------------------------------------------------------------
# Overdue / restart / idempotency
# ---------------------------------------------------------------------------------------

def test_overdue_job_runs_immediately_after_restart(db, tracked, meet):
    host = _user_with_google(db, tracked, "overdue")
    booking = _booking(db, host, datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2))
    meet.add("abc-defg-hij")

    # A brand-new session = a restarted process: all state is in the database.
    fresh = SessionLocal()
    try:
        res = asyncio.run(run_due_terminations(fresh))
    finally:
        fresh.close()
    assert res["terminated"] >= 1
    db.refresh(booking)
    assert booking.termination_status == "completed"

    pub = client.get(f"/api/bookings/public/{booking.public_id}").json()
    assert pub["is_expired"] is True and pub["google_meet_link"] is None
    assert pub["meeting_phase"] == "ended"


def test_second_sweep_does_nothing(db, tracked, meet):
    host = _user_with_google(db, tracked, "idem")
    _booking(db, host, T0)
    meet.add("abc-defg-hij")
    now = T0 + timedelta(minutes=33)
    assert _run(db, now)["terminated"] == 1
    assert _run(db, now)["terminated"] == 0
    assert len(meet.calls("POST")) == 1


def test_concurrent_sweeps_end_the_conference_once(db, tracked, meet):
    host = _user_with_google(db, tracked, "conc")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    now = T0 + timedelta(minutes=33)

    async def two_workers():
        s1, s2 = SessionLocal(), SessionLocal()
        try:
            return await asyncio.gather(run_due_terminations(s1, now=now), run_due_terminations(s2, now=now))
        finally:
            s1.close()
            s2.close()

    a, b = asyncio.run(two_workers())
    assert a["terminated"] + b["terminated"] == 1
    assert len(meet.calls("POST")) == 1
    db.refresh(booking)
    assert booking.termination_status == "completed"
    assert db.query(MeetingTerminationAttempt).filter(MeetingTerminationAttempt.booking_id == booking.id).count() == 1


def test_stale_claim_from_a_dead_worker_is_recovered(db, tracked, meet):
    host = _user_with_google(db, tracked, "stale")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    now = T0 + timedelta(minutes=33)
    booking.termination_status = "terminating"
    booking.termination_claimed_at = now - timedelta(minutes=meeting_termination.STALE_CLAIM_MINUTES + 1)
    db.commit()
    assert _run(db, now)["terminated"] == 1
    db.refresh(booking)
    assert booking.termination_status == "completed"


# ---------------------------------------------------------------------------------------
# Only end a conference that is active
# ---------------------------------------------------------------------------------------

def test_no_active_conference_makes_no_end_call(db, tracked, meet):
    host = _user_with_google(db, tracked, "idle")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij", active=False)
    res = _run(db, T0 + timedelta(minutes=33))
    assert res["already_ended"] == 1 and res["terminated"] == 0
    assert meet.calls("POST") == []
    db.refresh(booking)
    assert booking.termination_status == "no_active_conference"
    assert booking.terminated_at is None            # we did not end anything
    assert meeting_phase(booking, T0 + timedelta(minutes=34)) == "ended"


def test_conference_ending_between_check_and_end_is_not_a_failure(db, tracked, meet):
    host = _user_with_google(db, tracked, "race")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    meet.fail["POST"] = [400]
    res = _run(db, T0 + timedelta(minutes=33))
    assert res["already_ended"] == 1
    db.refresh(booking)
    assert booking.termination_status == "no_active_conference"


# ---------------------------------------------------------------------------------------
# Cancel / reschedule
# ---------------------------------------------------------------------------------------

def test_cancelled_booking_is_never_terminated(db, tracked, meet):
    host = _user_with_google(db, tracked, "cancel")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    booking.status = "cancelled"
    cancel_termination_job(booking)
    db.commit()
    res = _run(db, T0 + timedelta(minutes=40))
    assert res["notifications_sent"] == 0 and res["terminated"] == 0
    assert meet.log == []
    db.refresh(booking)
    assert booking.termination_status == "cancelled"
    assert meeting_phase(booking, T0 + timedelta(minutes=40)) == "cancelled"


def test_reschedule_moves_the_deadline_and_drops_the_old_one(db, tracked, meet):
    host = _user_with_google(db, tracked, "resched")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    old_due = booking.termination_due_at
    old_generation = booking.termination_generation

    new_start = T0 + timedelta(hours=1)
    booking.start_time = _wall(new_start)
    booking.end_time = _wall(new_start + timedelta(minutes=30))
    schedule_termination_job(booking)
    db.commit()
    assert booking.termination_due_at == new_start + timedelta(minutes=30 + GRACE_PERIOD_MINUTES)
    assert booking.termination_due_at != old_due
    assert booking.termination_generation == old_generation + 1

    # At the OLD deadline nothing happens: no notice, no call.
    res = _run(db, old_due)
    assert res["notifications_sent"] == 0 and res["terminated"] == 0 and meet.log == []

    # At the NEW deadline it ends.
    assert _run(db, new_start + timedelta(minutes=30))["notifications_sent"] == 1
    assert _run(db, new_start + timedelta(minutes=33))["terminated"] == 1


def test_stored_deadline_that_was_never_updated_cannot_end_a_meeting_early(db, tracked, meet):
    """Safety net: the sweep recomputes the deadline from end_time, not just from the stored copy."""
    host = _user_with_google(db, tracked, "forgot")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    new_start = T0 + timedelta(hours=2)
    booking.start_time = _wall(new_start)
    booking.end_time = _wall(new_start + timedelta(minutes=30))     # no schedule_termination_job()
    db.commit()
    assert _run(db, T0 + timedelta(minutes=33))["terminated"] == 0
    assert meet.log == []
    db.refresh(booking)
    assert booking.termination_due_at == new_start + timedelta(minutes=30 + GRACE_PERIOD_MINUTES)


def test_result_of_a_rescheduled_job_is_dropped(db, tracked, meet):
    """A worker mid-call when the booking is rescheduled must not write over the new schedule."""
    host = _user_with_google(db, tracked, "midflight")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    booking.termination_status = "terminating"
    db.commit()

    other = SessionLocal()
    try:
        fresh = other.query(Booking).filter(Booking.id == booking.id).one()
        new_start = T0 + timedelta(hours=1)
        fresh.start_time = _wall(new_start)
        fresh.end_time = _wall(new_start + timedelta(minutes=30))
        schedule_termination_job(fresh)
        other.commit()
    finally:
        other.close()

    result = asyncio.run(meeting_termination.terminate_booking_conference(db, booking))
    assert result["status"] == "completed"           # the call itself happened...
    db.expire_all()
    current = db.query(Booking).filter(Booking.id == booking.id).one()
    assert current.termination_status == "pending"   # ...but the new schedule is untouched
    assert current.terminated_at is None


# ---------------------------------------------------------------------------------------
# Failures
# ---------------------------------------------------------------------------------------

def test_timeout_is_retried_with_backoff_then_succeeds(db, tracked, meet):
    host = _user_with_google(db, tracked, "retry")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    meet.fail["GET"] = ["timeout"]
    now = T0 + timedelta(minutes=33)

    res = _run(db, now)
    assert res["retried"] == 1
    db.refresh(booking)
    assert booking.termination_status == "retry" and booking.termination_retries == 1
    assert booking.termination_next_attempt_at == now + timedelta(seconds=RETRY_BACKOFF_SECONDS[0])
    assert booking.terminated_at is None

    # Not before the backoff has elapsed...
    assert _run(db, now + timedelta(seconds=5))["terminated"] == 0
    assert meet.calls("POST") == []
    # ...and then it completes, once.
    res = _run(db, now + timedelta(seconds=RETRY_BACKOFF_SECONDS[0]))
    assert res["terminated"] == 1
    assert len(meet.calls("POST")) == 1
    db.refresh(booking)
    assert booking.termination_status == "completed"


def test_backoff_grows_and_gives_up(db, tracked, meet):
    host = _user_with_google(db, tracked, "giveup")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    meet.fail["GET"] = [503] * (len(RETRY_BACKOFF_SECONDS) + 2)
    now = T0 + timedelta(minutes=33)
    seen = []
    for _ in range(len(RETRY_BACKOFF_SECONDS) + 1):
        _run(db, now)
        db.refresh(booking)
        if booking.termination_status != "retry":
            break
        seen.append((booking.termination_next_attempt_at - now).total_seconds())
        now = booking.termination_next_attempt_at
    assert seen == [float(s) for s in RETRY_BACKOFF_SECONDS]
    assert booking.termination_status == "failed"
    assert "Gave up" in booking.termination_error
    assert meet.calls("POST") == []


@pytest.mark.parametrize("code", [403, 401])
def test_permission_error_is_permanent_and_reported(db, tracked, meet, code):
    host = _user_with_google(db, tracked, f"perm{code}")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    meet.fail["GET"] = [code]
    res = _run(db, T0 + timedelta(minutes=33))
    assert res["failed"] == 1 and res["terminated"] == 0
    db.refresh(booking)
    assert booking.termination_status == "failed"
    assert booking.termination_last_http_status == code
    assert "Reconnect Google" in booking.termination_error
    assert booking.terminated_at is None            # never claim an end Google did not accept
    assert db.query(Notification).filter(
        Notification.admin_id == host.id, Notification.type == "termination_failed").count() == 1
    assert meet.calls("POST") == []
    # Permanent: a later sweep does not retry it.
    _run(db, T0 + timedelta(hours=1))
    assert len(meet.calls("GET")) == 1
    assert meeting_phase(booking, T0 + timedelta(hours=1)) == "termination_failed"


def test_rejected_end_call_is_not_reported_as_ended(db, tracked, meet):
    host = _user_with_google(db, tracked, "rejectend")
    booking = _booking(db, host, T0)
    meet.add("abc-defg-hij")
    meet.fail["POST"] = [403]
    res = _run(db, T0 + timedelta(minutes=33))
    assert res["failed"] == 1 and res["terminated"] == 0
    db.refresh(booking)
    assert booking.termination_status == "failed" and booking.terminated_at is None
    assert meet.spaces["abc-defg-hij"]["active"] is True


def test_revoked_refresh_token_fails_without_disconnecting_the_host(db, tracked, meet, monkeypatch):
    host = _user_with_google(db, tracked, "revoked")
    booking = _booking(db, host, T0)

    async def failing_refresh(enc_token):
        raise ValueError("Token has been expired or revoked by user")

    monkeypatch.setattr(meeting_termination, "refresh_google_token", failing_refresh)
    res = _run(db, T0 + timedelta(minutes=33))
    assert res["failed"] == 1
    db.refresh(booking)
    assert booking.termination_status == "failed"
    assert "Reconnect Google" in booking.termination_error
    # A failed refresh is reported, never acted on: only an explicit disconnect ends a connection.
    conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == host.id).one()
    assert conn.connection_status == "connected"
    assert db.query(Notification).filter(
        Notification.admin_id == host.id, Notification.type == "termination_failed").count() == 1
    assert meet.log == []


# ---------------------------------------------------------------------------------------
# Correct conference only
# ---------------------------------------------------------------------------------------

def test_only_the_bookings_own_space_is_touched(db, tracked, meet):
    host_a = _user_with_google(db, tracked, "iso_a")
    host_b = _user_with_google(db, tracked, "iso_b")
    other = _user_with_google(db, tracked, "iso_c")
    _booking(db, host_a, T0, meet_code="space-host-a")
    _booking(db, host_b, T0, meet_code="space-host-b")
    # A different, still-running meeting that is not due yet and a stranger's space.
    _booking(db, other, T0 + timedelta(hours=5), meet_code="space-future")
    for code in ("space-host-a", "space-host-b", "space-future", "space-stranger"):
        meet.add(code)

    _run(db, T0 + timedelta(minutes=33))
    ended = {c[1] for c in meet.calls("POST")}
    assert ended == {"space-host-a", "space-host-b"}
    assert meet.spaces["space-future"]["active"] and meet.spaces["space-stranger"]["active"]
    tokens = {c[1]: c[2] for c in meet.calls("GET")}
    assert tokens["space-host-a"] != tokens["space-host-b"]   # each host's own credentials


def test_space_that_is_not_this_bookings_meeting_is_refused(db, tracked, meet):
    host = _user_with_google(db, tracked, "mismatch")
    booking = _booking(db, host, T0, meet_code="abc-defg-hij")
    meet.add("abc-defg-hij")
    # The space resolves to a different meeting code than the booking's own link.
    original = meet.handler

    def lying(request):
        res = original(request)
        if request.method == "GET" and res.status_code == 200:
            return httpx.Response(200, json={**res.json(), "meetingCode": "zzz-zzzz-zzz"})
        return res

    meeting_termination._http_transport = httpx.MockTransport(lying)
    res = _run(db, T0 + timedelta(minutes=33))
    assert res["failed"] == 1
    assert meet.calls("POST") == []
    db.refresh(booking)
    assert booking.termination_status == "failed"


# ---------------------------------------------------------------------------------------
# Every booking category follows the same rule
# ---------------------------------------------------------------------------------------

@pytest.mark.parametrize("role,category", [
    ("admin", "client"),
    ("super_admin", "client"),
    ("super_admin", "student_free"),
    ("super_admin", "student_paid"),
])
def test_every_category_terminates_at_end_plus_three(db, tracked, meet, role, category):
    host = _user_with_google(db, tracked, f"cat{category}{role}", role=role)
    booking = _booking(db, host, T0, duration_minutes=20, category=category)
    meet.add("abc-defg-hij")
    assert _run(db, T0 + timedelta(minutes=22))["terminated"] == 0
    assert _run(db, T0 + timedelta(minutes=23))["terminated"] == 1
    db.refresh(booking)
    assert booking.termination_status == "completed"
    if category.startswith("student"):
        assert booking.attendance_status == "completed"      # counted once, never twice
        _run(db, T0 + timedelta(minutes=40))
        db.refresh(booking)
        assert booking.attendance_status == "completed"
    else:
        assert booking.attendance_status is None


def test_student_attendance_is_recorded_even_when_google_is_down(db, tracked, meet):
    host = _user_with_google(db, tracked, "studdown", role="super_admin")
    booking = _booking(db, host, T0, category="student_free")
    meet.add("abc-defg-hij")
    meet.fail["GET"] = [503]
    _run(db, T0 + timedelta(minutes=33))
    db.refresh(booking)
    assert booking.termination_status == "retry"
    assert booking.attendance_status == "completed"


# ---------------------------------------------------------------------------------------
# Recordings are untouched
# ---------------------------------------------------------------------------------------

def test_termination_leaves_recording_artifacts_alone(db, tracked, meet):
    host = _user_with_google(db, tracked, "rec", role="super_admin")
    booking = _booking(db, host, T0, category="student_free")
    meet.add("abc-defg-hij")
    db.add(MeetingRecording(booking_id=booking.id, space_name="spaces/abc-defg-hij",
                            drive_file_id="drive-file-1", status="processing"))
    db.commit()
    _run(db, T0 + timedelta(minutes=33))
    # Only spaces.get and :endActiveConference were used: nothing that deletes or alters a space,
    # a conference record, a transcript or a recording.
    assert {c[0] for c in meet.log} == {"GET", "POST"}
    rec = db.query(MeetingRecording).filter(MeetingRecording.booking_id == booking.id).one()
    assert rec.status == "processing" and rec.drive_file_id == "drive-file-1"


# ---------------------------------------------------------------------------------------
# Phase, API fields, cron
# ---------------------------------------------------------------------------------------

def test_meeting_phase_progression(db, tracked, meet):
    host = _user_with_google(db, tracked, "phase")
    booking = _booking(db, host, T0, duration_minutes=20)
    assert meeting_phase(booking, T0 - timedelta(minutes=5)) == "scheduled"
    assert meeting_phase(booking, T0 + timedelta(minutes=10)) == "in_progress"
    assert meeting_phase(booking, T0 + timedelta(minutes=21)) == "termination_pending"
    assert meeting_phase(booking, T0 + timedelta(minutes=30)) == "termination_pending"   # overdue, not yet ended
    booking.termination_status = "completed"
    assert meeting_phase(booking, T0 + timedelta(minutes=30)) == "ended"


def test_public_booking_exposes_utc_deadlines_and_phase(db, tracked):
    host = _user_with_google(db, tracked, "pubfields")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    booking = _booking(db, host, now - timedelta(minutes=21), duration_minutes=20)   # ended 1 min ago
    data = client.get(f"/api/bookings/public/{booking.public_id}").json()
    assert data["meeting_phase"] == "termination_pending"
    assert data["grace_minutes"] == GRACE_PERIOD_MINUTES
    assert data["is_grace_period"] is True and data["is_expired"] is False
    assert data["google_meet_link"] is not None
    end = datetime.fromisoformat(data["scheduled_end_at"].replace("Z", "+00:00"))
    term = datetime.fromisoformat(data["termination_at"].replace("Z", "+00:00"))
    assert term - end == timedelta(minutes=GRACE_PERIOD_MINUTES)
    assert data["server_now"].endswith("Z")
    assert 0 < data["grace_remaining_seconds"] <= GRACE_PERIOD_MINUTES * 60


def test_internal_cron_endpoint(monkeypatch):
    secret = "test-cron-secret-12345"
    monkeypatch.setattr(settings, "CRON_SECRET", secret)
    assert client.post("/api/internal/termination/run").status_code == 403
    assert client.post("/api/internal/termination/run", headers={"x-cron-secret": "wrong"}).status_code == 403
    r3 = client.post("/api/internal/termination/run", headers={"x-cron-secret": secret})
    assert r3.status_code == 200
    assert "terminated" in r3.json()
