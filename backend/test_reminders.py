"""
Tests for server-side meeting reminders (services/reminders.py) and the Super Admin setting
that controls them.

run_due_reminders() is called directly with an explicit `now`, which is exactly what the
worker and the cron endpoint do -- nothing depends on a browser, a timer or a signed-in host.
Email is stubbed; the in-app Notification is real.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import (
    AdminProfile, Booking, MeetingReminder, Notification, PlatformSetting, Session as SessionModel, User,
)
from app.services import email_service, reminders
from app.services.platform_settings import MEETING_REMINDER_KEY

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
def reminder_setting():
    """Each test starts from the default setting and leaves the real one as it found it."""
    session = SessionLocal()
    saved = session.query(PlatformSetting).filter(PlatformSetting.key == MEETING_REMINDER_KEY).first()
    saved_value = dict(saved.value) if saved else None
    if saved:
        session.delete(saved)
        session.commit()
    # A reminder pass looks at every confirmed booking in the database, not only this test's.
    # Whatever it creates for bookings the test does not own is removed afterwards.
    reminders_before = {r for (r,) in session.query(MeetingReminder.id)}
    notes_before = {n for (n,) in session.query(Notification.id).filter(Notification.type == "meeting_reminder")}
    yield
    session.query(MeetingReminder).filter(MeetingReminder.id.notin_(reminders_before)).delete(synchronize_session=False)
    session.query(Notification).filter(
        Notification.type == "meeting_reminder", Notification.id.notin_(notes_before)
    ).delete(synchronize_session=False)
    row = session.query(PlatformSetting).filter(PlatformSetting.key == MEETING_REMINDER_KEY).first()
    if row:
        session.delete(row)
    if saved_value is not None:
        session.add(PlatformSetting(key=MEETING_REMINDER_KEY, value=saved_value))
    session.commit()
    session.close()


@pytest.fixture
def emails(monkeypatch):
    sent = []

    async def fake_send(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_meeting_reminder_email", fake_send)
    return sent


@pytest.fixture
def tracked():
    ids = []
    yield ids
    session = SessionLocal()
    try:
        for user_id in ids:
            booking_ids = [b.id for b in session.query(Booking).filter(Booking.admin_id == user_id)]
            session.query(MeetingReminder).filter(MeetingReminder.admin_id == user_id).delete(synchronize_session=False)
            session.query(Notification).filter(Notification.admin_id == user_id).delete(synchronize_session=False)
            if booking_ids:
                session.query(Booking).filter(Booking.id.in_(booking_ids)).delete(synchronize_session=False)
            session.query(SessionModel).filter(SessionModel.admin_id == user_id).delete(synchronize_session=False)
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _user(db, tracked, role="admin", tag="h"):
    uid = uuid.uuid4().hex[:8]
    user = User(name=f"Host {tag}", email=f"rem_{tag}_{uid}@testdomain.com",
                password_hash=get_password_hash(PASSWORD), role=role, status="ACTIVE")
    db.add(user)
    db.flush()
    db.add(AdminProfile(user_id=user.id, username=f"rem{tag}{uid}"))
    db.commit()
    tracked.append(user.id)
    return user


def _headers(user):
    res = client.post("/api/auth/login", json={"username_or_email": user.email, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _wall(dt_utc: datetime) -> str:
    """UTC instant -> the stored booking format (business wall clock with a cosmetic Z)."""
    return dt_utc.replace(tzinfo=timezone.utc).astimezone(BUSINESS_TZ).strftime("%Y-%m-%dT%H:%M:00Z")


def _booking(db, host, start_utc: datetime, status="confirmed", link="https://meet.google.com/abc-defg-hij"):
    session = SessionModel(admin_id=host.id, title="30 Minute Consultation", duration_minutes=30, price=99900)
    db.add(session)
    db.flush()
    booking = Booking(
        public_id=f"BK-RM-{uuid.uuid4().hex[:8].upper()}", admin_id=host.id, meeting_type_id=session.id,
        client_name="Rahul", client_email="rahul@example.com",
        start_time=_wall(start_utc), end_time=_wall(start_utc + timedelta(minutes=30)),
        status=status, payment_status="completed" if status == "confirmed" else "pending",
        google_meet_link=link, cancellation_token=uuid.uuid4().hex,
    )
    db.add(booking)
    db.commit()
    return booking


def _run(db, now):
    return asyncio.run(reminders.run_due_reminders(db, now=now))


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None, second=0, microsecond=0)


# ---------------------------------------------------------------------------------------
# Scheduling and delivery
# ---------------------------------------------------------------------------------------

def test_confirmed_booking_reminds_its_host_at_the_default_lead(db, tracked, emails):
    host = _user(db, tracked)
    start = _utcnow() + timedelta(hours=3)
    booking = _booking(db, host, start)

    _run(db, now=_utcnow())
    row = db.query(MeetingReminder).filter(MeetingReminder.booking_id == booking.id).one()
    assert row.lead_minutes == 5
    assert row.remind_at == start - timedelta(minutes=5)
    assert row.status == "pending" and not emails

    _run(db, now=start - timedelta(minutes=6))
    assert not emails, "one minute early must not send"

    _run(db, now=start - timedelta(minutes=5))
    db.refresh(row)
    assert row.status == "sent" and row.sent_at and row.email_sent
    assert len(emails) == 1
    assert emails[0]["admin_email"] == host.email
    assert emails[0]["client_name"] == "Rahul"
    assert emails[0]["session_title"] == "30 Minute Consultation"
    assert emails[0]["meet_link"] == "https://meet.google.com/abc-defg-hij"
    note = db.query(Notification).filter(Notification.admin_id == host.id, Notification.type == "meeting_reminder").one()
    assert "Rahul" in note.title and "meet.google.com" in note.message


def test_reminder_is_never_sent_twice(db, tracked, emails):
    host = _user(db, tracked)
    start = _utcnow() + timedelta(hours=1)
    _booking(db, host, start)
    due = start - timedelta(minutes=5)
    _run(db, now=due)
    _run(db, now=due)
    _run(db, now=due + timedelta(minutes=1))
    assert len(emails) == 1
    assert db.query(Notification).filter(Notification.admin_id == host.id, Notification.type == "meeting_reminder").count() == 1


def test_one_row_per_booking_and_start_time(db, tracked, emails):
    host = _user(db, tracked)
    booking = _booking(db, host, _utcnow() + timedelta(hours=2))
    for _ in range(3):
        reminders.ensure_reminder(db, booking)
    assert db.query(MeetingReminder).filter(MeetingReminder.booking_id == booking.id).count() == 1


@pytest.mark.parametrize("status", ["pending_payment", "cancelled", "expired"])
def test_unconfirmed_bookings_get_no_reminder(db, tracked, emails, status):
    host = _user(db, tracked)
    start = _utcnow() + timedelta(hours=1)
    booking = _booking(db, host, start, status=status)
    _run(db, now=start - timedelta(minutes=5))
    assert db.query(MeetingReminder).filter(MeetingReminder.booking_id == booking.id).count() == 0
    assert not emails


def test_cancelled_after_scheduling_is_skipped(db, tracked, emails):
    host = _user(db, tracked)
    start = _utcnow() + timedelta(hours=1)
    booking = _booking(db, host, start)
    _run(db, now=_utcnow())
    booking.status = "cancelled"
    db.commit()
    _run(db, now=start - timedelta(minutes=5))
    row = db.query(MeetingReminder).filter(MeetingReminder.booking_id == booking.id).one()
    assert row.status == "skipped" and row.detail == "booking_cancelled"
    assert not emails


def test_reschedule_skips_the_old_time_and_reminds_for_the_new(db, tracked, emails):
    host = _user(db, tracked)
    old_start = _utcnow() + timedelta(hours=1)
    booking = _booking(db, host, old_start)
    _run(db, now=_utcnow())

    new_start = old_start + timedelta(hours=2)
    booking.start_time = _wall(new_start)
    booking.end_time = _wall(new_start + timedelta(minutes=30))
    db.commit()

    _run(db, now=old_start - timedelta(minutes=5))
    assert not emails, "the old time must not be reminded"
    rows = {r.booking_start_time: r for r in db.query(MeetingReminder).filter(MeetingReminder.booking_id == booking.id)}
    assert rows[_wall(old_start)].status == "skipped" and rows[_wall(old_start)].detail == "rescheduled"
    assert rows[_wall(new_start)].remind_at == new_start - timedelta(minutes=5)

    _run(db, now=new_start - timedelta(minutes=5))
    assert len(emails) == 1


def test_never_sent_after_the_meeting_started(db, tracked, emails):
    host = _user(db, tracked)
    start = _utcnow() + timedelta(hours=1)
    booking = _booking(db, host, start)
    _run(db, now=_utcnow())
    _run(db, now=start + timedelta(minutes=1))  # the server was asleep through the reminder time
    row = db.query(MeetingReminder).filter(MeetingReminder.booking_id == booking.id).one()
    assert row.status == "skipped" and row.detail == "meeting_started"
    assert not emails


def test_booking_without_a_meet_link_still_reminds(db, tracked, emails):
    host = _user(db, tracked)
    start = _utcnow() + timedelta(hours=1)
    _booking(db, host, start, link=None)
    _run(db, now=start - timedelta(minutes=5))
    assert len(emails) == 1 and emails[0]["meet_link"] is None


def test_email_failure_still_records_the_in_app_reminder_once(db, tracked, monkeypatch):
    async def failing(**kwargs):
        return False

    monkeypatch.setattr(email_service, "send_meeting_reminder_email", failing)
    host = _user(db, tracked)
    start = _utcnow() + timedelta(hours=1)
    booking = _booking(db, host, start)
    _run(db, now=start - timedelta(minutes=5))
    _run(db, now=start - timedelta(minutes=4))
    row = db.query(MeetingReminder).filter(MeetingReminder.booking_id == booking.id).one()
    assert row.status == "sent" and row.email_sent is False and row.detail == "in_app"
    assert db.query(Notification).filter(Notification.admin_id == host.id, Notification.type == "meeting_reminder").count() == 1


def test_timezone_is_the_business_zone_not_utc(db, tracked, emails):
    host = _user(db, tracked)
    # 10:00 wall clock in the business zone, a day ahead.
    day = (datetime.now(BUSINESS_TZ) + timedelta(days=2)).date()
    start_wall = datetime(day.year, day.month, day.day, 10, 0, tzinfo=BUSINESS_TZ)
    start_utc = start_wall.astimezone(timezone.utc).replace(tzinfo=None)
    booking = _booking(db, host, start_utc)
    assert booking.start_time.endswith("T10:00:00Z")
    row = reminders.ensure_reminder(db, booking)
    remind_wall = row.remind_at.replace(tzinfo=timezone.utc).astimezone(BUSINESS_TZ)
    assert (remind_wall.hour, remind_wall.minute) == (9, 55)


# ---------------------------------------------------------------------------------------
# The Super Admin setting
# ---------------------------------------------------------------------------------------

def test_only_the_super_admin_can_read_or_change_the_setting(db, tracked):
    admin = _user(db, tracked, role="admin", tag="a")
    boss = _user(db, tracked, role="super_admin", tag="s")
    assert client.get("/api/super-admin/settings/reminders").status_code == 401
    assert client.put("/api/super-admin/settings/reminders", headers=_headers(admin),
                      json={"enabled": True, "lead_minutes": 60}).status_code == 403
    res = client.get("/api/super-admin/settings/reminders", headers=_headers(boss))
    assert res.status_code == 200
    assert (res.json()["enabled"], res.json()["lead_minutes"]) == (True, 5)
    assert res.json()["choices"] == [5, 10, 15, 30, 60, 120, 1440]


def test_invalid_lead_is_rejected(db, tracked):
    boss = _user(db, tracked, role="super_admin", tag="s")
    res = client.put("/api/super-admin/settings/reminders", headers=_headers(boss), json={"enabled": True, "lead_minutes": 7})
    assert res.status_code == 400


def test_new_setting_applies_to_new_bookings_only(db, tracked, emails):
    boss = _user(db, tracked, role="super_admin", tag="s")
    host = _user(db, tracked)
    start = _utcnow() + timedelta(days=2)
    existing = _booking(db, host, start)
    _run(db, now=_utcnow())

    res = client.put("/api/super-admin/settings/reminders", headers=_headers(boss), json={"enabled": True, "lead_minutes": 60})
    assert res.status_code == 200 and res.json()["lead_minutes"] == 60

    later = _booking(db, host, start + timedelta(hours=3))
    _run(db, now=_utcnow())
    db.expire_all()
    old_row = db.query(MeetingReminder).filter(MeetingReminder.booking_id == existing.id).one()
    new_row = db.query(MeetingReminder).filter(MeetingReminder.booking_id == later.id).one()
    assert old_row.lead_minutes == 5
    assert new_row.lead_minutes == 60
    assert db.query(Booking).filter(Booking.id == existing.id).one().start_time == existing.start_time


def test_disabled_reminders_schedule_and_send_nothing(db, tracked, emails):
    boss = _user(db, tracked, role="super_admin", tag="s")
    client.put("/api/super-admin/settings/reminders", headers=_headers(boss), json={"enabled": False, "lead_minutes": 5})
    host = _user(db, tracked)
    start = _utcnow() + timedelta(hours=1)
    booking = _booking(db, host, start)
    _run(db, now=start - timedelta(minutes=5))
    assert db.query(MeetingReminder).filter(MeetingReminder.booking_id == booking.id).count() == 0
    assert not emails


# ---------------------------------------------------------------------------------------
# The cron endpoint
# ---------------------------------------------------------------------------------------

def test_cron_endpoint_requires_the_secret(monkeypatch):
    monkeypatch.setattr(settings, "CRON_SECRET", "")
    assert client.post("/api/internal/reminders/run").status_code == 404
    monkeypatch.setattr(settings, "CRON_SECRET", "s3cret-value")
    assert client.post("/api/internal/reminders/run").status_code == 403
    assert client.post("/api/internal/reminders/run", headers={"X-Cron-Secret": "wrong"}).status_code == 403
    ok = client.post("/api/internal/reminders/run", headers={"X-Cron-Secret": "s3cret-value"})
    assert ok.status_code == 200 and set(ok.json()) == {"scheduled", "sent", "skipped"}


def test_notifications_are_per_host(db, tracked, emails):
    a = _user(db, tracked, tag="a")
    b = _user(db, tracked, tag="b")
    start = _utcnow() + timedelta(hours=1)
    _booking(db, a, start)
    _run(db, now=start - timedelta(minutes=5))
    a_notes = client.get("/api/notifications/", headers=_headers(a)).json()
    b_notes = client.get("/api/notifications/", headers=_headers(b)).json()
    assert any(n["type"] == "meeting_reminder" for n in a_notes)
    assert not any(n["type"] == "meeting_reminder" for n in b_notes)
