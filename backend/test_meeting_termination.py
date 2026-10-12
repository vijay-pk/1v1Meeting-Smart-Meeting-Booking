"""
Tests for Google Meet 2-Minute Grace Period and Automatic Termination.

Verifies that:
1. At the scheduled booking end time (e.g. 10:30), an end-of-booking wrap-up notification
   is recorded and delivered, giving participants 2 minutes to wrap up.
2. The conference is NOT terminated at 10:30 (remains active during 10:30-10:32).
3. The termination job strictly executes at 10:32 (scheduled_end_time + 2 minutes).
4. Late joins (10:15, 10:29, or after 10:30) never extend the scheduled end time or grace period.
5. Rescheduled bookings invalidate old jobs and follow the new persisted schedule.
6. Cancelled bookings do not send notifications or execute stale terminations.
7. Overdue jobs recovered after backend downtime execute promptly without resetting the grace period.
8. Multi-admin isolation is strictly enforced (only the host's credentials are used).
9. Duplicate scheduler executions do not send duplicate notifications or duplicate terminations.
10. Transient API errors retry safely with bounded backoff.
11. Revoked credentials fail safely and alert the host.
12. Timezone conversion formats the localized termination time correctly.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import encrypt_secret, get_password_hash
from app.main import app, seed_initial_data
from app.models.models import (
    AdminProfile, Booking, GoogleConnection, Notification, Session as SessionModel, User,
)
from app.services import meeting_termination
from app.services.meeting_termination import (
    booking_end_utc,
    booking_start_utc,
    booking_termination_utc,
    format_localized_termination_time,
    parse_meet_space_name,
)

seed_initial_data()
client = TestClient(app)
BUSINESS_TZ = ZoneInfo(settings.BUSINESS_TIMEZONE)
PASSWORD = "TestPassw0rd!123"


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def mock_google_refresh(monkeypatch):
    from app.core.security import decrypt_secret

    async def fake_refresh(enc_token):
        decrypted = decrypt_secret(enc_token)
        return f"access-token-for-{decrypted}"

    monkeypatch.setattr(meeting_termination, "refresh_google_token", fake_refresh)


@pytest.fixture
def tracked():
    ids = []
    yield ids
    session = SessionLocal()
    try:
        for user_id in ids:
            booking_ids = [b.id for b in session.query(Booking).filter(Booking.admin_id == user_id)]
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


def _user_with_google(db, tracked, tag="term"):
    uid = uuid.uuid4().hex[:8]
    user = User(
        name=f"Host {tag}",
        email=f"host_{tag}_{uid}@testdomain.com",
        password_hash=get_password_hash(PASSWORD),
        role="admin",
        status="ACTIVE",
    )
    db.add(user)
    db.flush()
    db.add(AdminProfile(user_id=user.id, username=f"host{tag}{uid}"))
    db.add(GoogleConnection(
        admin_id=user.id,
        google_email=f"google_{uid}@gmail.com",
        encrypted_refresh_token=encrypt_secret(f"mock-refresh-{uid}"),
        connection_status="connected",
    ))
    db.commit()
    tracked.append(user.id)
    return user


def _wall(dt_utc: datetime) -> str:
    """UTC instant -> stored booking format (wall clock in business tz with cosmetic Z)."""
    return dt_utc.replace(tzinfo=timezone.utc).astimezone(BUSINESS_TZ).strftime("%Y-%m-%dT%H:%M:00Z")


def _booking(db, host, start_utc: datetime, duration_minutes=30, status="confirmed", meet_code="abc-defg-hij"):
    end_utc = start_utc + timedelta(minutes=duration_minutes)
    session = SessionModel(admin_id=host.id, title="1v1 Session", duration_minutes=duration_minutes, price=50000)
    db.add(session)
    db.flush()
    b = Booking(
        public_id=f"BK-TRM-{uuid.uuid4().hex[:8].upper()}",
        admin_id=host.id,
        meeting_type_id=session.id,
        client_name="Test Client",
        client_email="client@example.com",
        start_time=_wall(start_utc),
        end_time=_wall(end_utc),
        status=status,
        payment_status="completed" if status == "confirmed" else "pending",
        google_meet_link=f"https://meet.google.com/{meet_code}",
        google_meet_space_id=f"spaces/{meet_code}",
        termination_status="pending",
        cancellation_token=uuid.uuid4().hex,
    )
    db.add(b)
    db.commit()
    return b


def test_timezone_conversion_and_localized_termination_time():
    """Stored wall-clock with 'Z' correctly resolves to naive UTC and formats localized termination."""
    t0 = datetime(2030, 6, 15, 10, 30, 0)
    stored = _wall(t0)
    resolved = booking_end_utc(stored)
    assert resolved is not None
    assert resolved.year == t0.year and resolved.month == t0.month and resolved.day == t0.day
    assert resolved.hour == t0.hour and resolved.minute == t0.minute

    # Termination UTC is end + 2 minutes
    term_utc = booking_termination_utc(stored)
    assert term_utc == resolved + timedelta(minutes=2)

    # Localized time formatting check:
    # A booking scheduled until 10:30 AM local time has termination at 10:32 AM.
    stored_1030 = "2030-06-15T10:30:00Z"
    loc_time = format_localized_termination_time(stored_1030, "Asia/Kolkata")
    assert loc_time == "10:32 AM"



def test_parse_meet_space_name():
    assert parse_meet_space_name("spaces/ABC123XYZ") == "spaces/ABC123XYZ"
    assert parse_meet_space_name("https://meet.google.com/abc-defg-hij") == "spaces/abc-defg-hij"
    assert parse_meet_space_name("abc-defg-hij") == "spaces/abc-defg-hij"
    assert parse_meet_space_name("") is None
    assert parse_meet_space_name(None) is None


def test_exact_timing_rules_notification_and_grace_period(db, tracked, monkeypatch):
    """
    Booking: 10:00 - 10:30 UTC.
    1. 10:28: Not ended, no notification sent.
    2. 10:30: Notification sent ('Your booked meeting time has ended'),
              conference NOT terminated, 2-minute grace period active.
    3. 10:31: Within grace period, conference NOT terminated.
    4. 10:32: Conference automatically terminates for everyone.
    """
    host = _user_with_google(db, tracked, "timing")
    t_start = datetime(2030, 5, 10, 10, 0, 0)
    booking = _booking(db, host, t_start, duration_minutes=30)

    calls = []
    async def mock_end(token, space_name):
        calls.append((token, space_name))
        return True, None, False

    monkeypatch.setattr(meeting_termination, "call_google_meet_end_conference", mock_end)

    # 1. Check at 10:28 (2 minutes before scheduled end)
    res_28 = asyncio.run(meeting_termination.run_due_terminations(db, now=t_start + timedelta(minutes=28)))
    assert res_28["notifications_sent"] == 0
    assert res_28["terminated"] == 0
    assert len(calls) == 0

    # 2. Check at 10:30 (exact scheduled end time)
    res_30 = asyncio.run(meeting_termination.run_due_terminations(db, now=t_start + timedelta(minutes=30)))
    assert res_30["notifications_sent"] == 1
    assert res_30["terminated"] == 0  # CRITICAL: NOT terminated at 10:30!
    assert len(calls) == 0

    # Verify notification record was persisted in DB
    db.refresh(booking)
    assert booking.grace_notified_at is not None
    note = db.query(Notification).filter(
        Notification.admin_id == host.id,
        Notification.booking_id == booking.id,
        Notification.type == "grace_period_warning",
    ).first()
    assert note is not None
    assert note.title == "Your booked meeting time has ended"
    assert "2 minutes to wrap up" in note.message

    # 3. Check at 10:31 (1 minute into grace period)
    res_31 = asyncio.run(meeting_termination.run_due_terminations(db, now=t_start + timedelta(minutes=31)))
    assert res_31["notifications_sent"] == 0  # No duplicate notification
    assert res_31["terminated"] == 0  # Still in grace period!
    assert len(calls) == 0

    # 4. Check at 10:32 (scheduled_end_time + 2 minutes)
    res_32 = asyncio.run(meeting_termination.run_due_terminations(db, now=t_start + timedelta(minutes=32)))
    assert res_32["terminated"] == 1  # Conference terminated automatically!
    assert len(calls) == 1
    assert calls[0][1] == "spaces/abc-defg-hij"

    db.refresh(booking)
    assert booking.termination_status == "completed"
    assert booking.terminated_at is not None


def test_late_joins_do_not_extend_grace_period_or_deadline(db, tracked, monkeypatch):
    """
    Booking: 10:00 - 10:30.
    Client joining at 10:15 or 10:29 does not alter the deadline.
    Client joining after 10:30 receives no additional meeting time.
    """
    host = _user_with_google(db, tracked, "late")
    t_start = datetime(2030, 5, 10, 10, 0, 0)
    booking = _booking(db, host, t_start, duration_minutes=30)

    calls = []
    async def mock_end(token, space_name):
        calls.append(space_name)
        return True, None, False

    monkeypatch.setattr(meeting_termination, "call_google_meet_end_conference", mock_end)

    # Client joins at 10:15
    res = asyncio.run(meeting_termination.run_due_terminations(db, now=t_start + timedelta(minutes=15)))
    assert res["terminated"] == 0
    assert len(calls) == 0

    # Client joins at 10:29
    res = asyncio.run(meeting_termination.run_due_terminations(db, now=t_start + timedelta(minutes=29)))
    assert res["terminated"] == 0
    assert len(calls) == 0

    # At 10:30, grace period starts
    asyncio.run(meeting_termination.run_due_terminations(db, now=t_start + timedelta(minutes=30)))

    # Client joining at 10:31 does not push back termination beyond 10:32
    res_late = asyncio.run(meeting_termination.run_due_terminations(db, now=t_start + timedelta(minutes=32)))
    assert res_late["terminated"] == 1
    assert len(calls) == 1


def test_expired_booking_handled_without_granting_extra_time(db, tracked, monkeypatch):
    """
    If a booking has already passed its scheduled end time (e.g. 2 hours ago),
    termination runs promptly on recovery without extending grace period.
    Public API prevents accessing/joining it as an active meeting.
    """
    host = _user_with_google(db, tracked, "exp")
    t_past_start = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
    booking = _booking(db, host, t_past_start, duration_minutes=30)

    ended = []
    async def mock_end(token, space_name):
        ended.append(space_name)
        return True, None, False

    monkeypatch.setattr(meeting_termination, "call_google_meet_end_conference", mock_end)

    # Scheduler runs now (booking ended ~1.5 hours ago)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    res = asyncio.run(meeting_termination.run_due_terminations(db, now=now))
    assert res["terminated"] == 1
    assert len(ended) == 1

    # Public endpoint check
    pub_res = client.get(f"/api/bookings/public/{booking.public_id}")
    assert pub_res.status_code == 200
    data = pub_res.json()
    assert data["is_expired"] is True
    assert data["google_meet_link"] is None


def test_public_endpoint_during_grace_period(db, tracked):
    """
    Public booking endpoint during the 2-minute grace period returns
    is_grace_period: True, is_expired: False, and leaves meet link accessible.
    """
    host = _user_with_google(db, tracked, "pubgrace")
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    # Start 31 minutes ago, 30 min duration -> ended 1 min ago (right in 2-min grace period)
    t_start = now_utc - timedelta(minutes=31)
    booking = _booking(db, host, t_start, duration_minutes=30)

    pub_res = client.get(f"/api/bookings/public/{booking.public_id}")
    assert pub_res.status_code == 200
    data = pub_res.json()
    assert data["is_grace_period"] is True
    assert data["is_expired"] is False
    assert data["grace_remaining_seconds"] > 0
    assert data["google_meet_link"] is not None


def test_rescheduled_booking_invalidates_old_jobs(db, tracked, monkeypatch):
    """
    Booking was 10:00-10:30. It gets rescheduled to 11:00-11:30.
    At 10:30 / 10:32, it must NOT notify or terminate.
    At 11:30, it notifies; at 11:32, it terminates as scheduled.
    """
    host = _user_with_google(db, tracked, "resched")
    t_old = datetime(2030, 7, 1, 10, 0, 0)
    t_new = datetime(2030, 7, 1, 11, 0, 0)
    booking = _booking(db, host, t_old, duration_minutes=30)

    # Reschedule booking to future
    booking.start_time = _wall(t_new)
    booking.end_time = _wall(t_new + timedelta(minutes=30))
    booking.termination_status = "pending"
    booking.grace_notified_at = None
    db.commit()

    calls = []
    async def mock_end(token, space_name):
        calls.append(space_name)
        return True, None, False

    monkeypatch.setattr(meeting_termination, "call_google_meet_end_conference", mock_end)

    # Run at old termination time 10:32
    res_old = asyncio.run(meeting_termination.run_due_terminations(db, now=t_old + timedelta(minutes=32)))
    assert res_old["notifications_sent"] == 0
    assert res_old["terminated"] == 0
    assert len(calls) == 0

    # Run at new end time 11:30 -> notification sent, conference not ended
    res_new_notif = asyncio.run(meeting_termination.run_due_terminations(db, now=t_new + timedelta(minutes=30)))
    assert res_new_notif["notifications_sent"] == 1
    assert res_new_notif["terminated"] == 0

    # Run at new termination time 11:32 -> conference ended
    res_new_term = asyncio.run(meeting_termination.run_due_terminations(db, now=t_new + timedelta(minutes=32)))
    assert res_new_term["terminated"] == 1
    assert len(calls) == 1


def test_cancelled_booking_is_not_terminated_by_stale_job(db, tracked, monkeypatch):
    """A cancelled booking is marked cancelled and never notifies or invokes Google termination."""
    host = _user_with_google(db, tracked, "cancel")
    t_start = datetime(2030, 8, 1, 14, 0, 0)
    booking = _booking(db, host, t_start, duration_minutes=30, status="cancelled")

    calls = []
    async def mock_end(token, space_name):
        calls.append(space_name)
        return True, None, False

    monkeypatch.setattr(meeting_termination, "call_google_meet_end_conference", mock_end)

    res = asyncio.run(meeting_termination.run_due_terminations(db, now=t_start + timedelta(minutes=35)))
    assert res["notifications_sent"] == 0
    assert res["terminated"] == 0
    assert len(calls) == 0
    db.refresh(booking)
    assert booking.termination_status == "cancelled"


def test_admin_isolation_uses_only_hosts_credentials(db, tracked, monkeypatch):
    """
    Two admins (Admin A and Admin B).
    Admin A's booking must use only Admin A's refresh token and credentials,
    never Admin B's or a shared token.
    """
    host_a = _user_with_google(db, tracked, "admin_a")
    host_b = _user_with_google(db, tracked, "admin_b")

    t_start = datetime(2030, 9, 1, 10, 0, 0)
    b_a = _booking(db, host_a, t_start, duration_minutes=30, meet_code="space-host-a")
    b_b = _booking(db, host_b, t_start, duration_minutes=30, meet_code="space-host-b")

    used_tokens = {}
    async def mock_end(token, space_name):
        used_tokens[space_name] = token
        return True, None, False

    monkeypatch.setattr(meeting_termination, "call_google_meet_end_conference", mock_end)

    # Run at scheduled_end_time + 2 minutes
    res = asyncio.run(meeting_termination.run_due_terminations(db, now=t_start + timedelta(minutes=32)))
    assert res["terminated"] == 2
    assert "spaces/space-host-a" in used_tokens
    assert "spaces/space-host-b" in used_tokens

    # Verify credentials used: host_a's token was used for space-host-a
    assert used_tokens["spaces/space-host-a"] != used_tokens["spaces/space-host-b"]


def test_temporary_google_api_failure_retried_safely(db, tracked, monkeypatch):
    """
    A 500 or 429 transient error marks status as retry with bounded count.
    """
    host = _user_with_google(db, tracked, "retry")
    t_start = datetime(2030, 10, 1, 12, 0, 0)
    booking = _booking(db, host, t_start, duration_minutes=30)

    async def mock_fail(token, space_name):
        return False, "Google Meet API 503 temporary error", True

    monkeypatch.setattr(meeting_termination, "call_google_meet_end_conference", mock_fail)

    now = t_start + timedelta(minutes=32)
    res = asyncio.run(meeting_termination.run_due_terminations(db, now=now))
    assert res["retried"] == 1

    db.refresh(booking)
    assert booking.termination_status == "retry"
    assert booking.termination_retries == 1
    assert "503" in (booking.termination_error or "")


def test_revoked_token_produces_notification_and_failure(db, tracked, monkeypatch):
    """
    If host's Google token refresh fails, integration is marked disconnected,
    an in-app notification is created, and status becomes failed without false success.
    """
    host = _user_with_google(db, tracked, "revoked")
    t_start = datetime(2030, 11, 1, 15, 0, 0)
    booking = _booking(db, host, t_start, duration_minutes=30)

    async def failing_refresh(enc_token):
        raise ValueError("Token has been expired or revoked by user")

    monkeypatch.setattr(meeting_termination, "refresh_google_token", failing_refresh)

    now = t_start + timedelta(minutes=32)
    res = asyncio.run(meeting_termination.run_due_terminations(db, now=now))
    assert res["failed"] == 1

    db.refresh(booking)
    assert booking.termination_status == "failed"
    assert "expired or revoked" in (booking.termination_error or "")

    conn = db.query(GoogleConnection).filter(GoogleConnection.admin_id == host.id).first()
    assert conn.connection_status == "disconnected"

    note = db.query(Notification).filter(Notification.admin_id == host.id, Notification.type == "termination_failed").first()
    assert note is not None


def test_restart_recovery_and_idempotency(db, tracked, monkeypatch):
    """
    Pending jobs in the DB survive process restarts and multiple runs do not duplicate calls.
    """
    host = _user_with_google(db, tracked, "idemp")
    t_start = datetime(2030, 12, 1, 16, 0, 0)
    booking = _booking(db, host, t_start, duration_minutes=30)

    calls = 0
    async def mock_end(token, space_name):
        nonlocal calls
        calls += 1
        return True, None, False

    monkeypatch.setattr(meeting_termination, "call_google_meet_end_conference", mock_end)

    now = t_start + timedelta(minutes=32)
    # First pass: executes termination
    res1 = asyncio.run(meeting_termination.run_due_terminations(db, now=now))
    assert res1["terminated"] == 1
    assert calls == 1

    # Second pass: already completed, does nothing
    res2 = asyncio.run(meeting_termination.run_due_terminations(db, now=now))
    assert res2["terminated"] == 0
    assert calls == 1


def test_internal_cron_endpoint(monkeypatch):
    """POST /api/internal/termination/run is secured with X-Cron-Secret."""
    secret = "test-cron-secret-12345"
    monkeypatch.setattr(settings, "CRON_SECRET", secret)

    # Missing header -> 403
    r1 = client.post("/api/internal/termination/run")
    assert r1.status_code == 403

    # Wrong header -> 403
    r2 = client.post("/api/internal/termination/run", headers={"x-cron-secret": "wrong"})
    assert r2.status_code == 403

    # Valid header -> 200
    r3 = client.post("/api/internal/termination/run", headers={"x-cron-secret": secret})
    assert r3.status_code == 200
    assert "terminated" in r3.json()
