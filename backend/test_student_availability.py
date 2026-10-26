"""
Student booking availability: the 20-minute slot grid, automatic next-available-date discovery,
Google Calendar handling, and the backend re-validating every student booking.

Deterministic: the availability tests freeze "now" to Monday 2030-06-10 08:00 in the business
timezone; booking tests use fixed 2030 dates. The student host is pinned to a throwaway Super
Admin so the real seeded one is never touched. Each test builds and tears down its own rows.
"""
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.api import availability as availability_api
from app.api import student_portal
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.main import app, seed_initial_data
from app.models.models import (
    AdminProfile, AllowanceAdjustment, AvailabilityRule, Booking, GoogleConnection,
    MeetingReminder, Notification, Payment, Session as SessionModel, SessionTimeWindow, SlotLock,
    StudentAllowance, User,
)
from app.services.google_calendar import GoogleCalendarUnavailable

seed_initial_data()
client = TestClient(app)
PW = "OwnerPassw0rd!1"

MONDAY, TUESDAY, FRIDAY = "2030-06-10", "2030-06-11", "2030-06-14"
DOW = {"mon": 1, "tue": 2, "fri": 5}


@pytest.fixture
def tracked():
    ids = []
    yield ids
    db = SessionLocal()
    try:
        for uid in ids:
            booking_ids = [b.id for b in db.query(Booking).filter((Booking.admin_id == uid) | (Booking.student_id == uid)).all()]
            if booking_ids:
                db.query(Payment).filter(Payment.booking_id.in_(booking_ids)).delete(synchronize_session=False)
                db.query(MeetingReminder).filter(MeetingReminder.booking_id.in_(booking_ids)).delete(synchronize_session=False)
            db.query(Notification).filter(Notification.admin_id == uid).delete(synchronize_session=False)
            db.query(Booking).filter((Booking.admin_id == uid) | (Booking.student_id == uid)).delete(synchronize_session=False)
            db.query(SlotLock).filter(SlotLock.admin_id == uid).delete(synchronize_session=False)
            db.query(SessionTimeWindow).filter(SessionTimeWindow.admin_id == uid).delete(synchronize_session=False)
            db.query(SessionModel).filter(SessionModel.admin_id == uid).delete(synchronize_session=False)
            db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == uid).delete(synchronize_session=False)
            db.query(GoogleConnection).filter(GoogleConnection.admin_id == uid).delete(synchronize_session=False)
            db.query(AllowanceAdjustment).filter(AllowanceAdjustment.student_id == uid).delete(synchronize_session=False)
            db.query(StudentAllowance).filter(StudentAllowance.student_id == uid).delete(synchronize_session=False)
            db.query(AdminProfile).filter(AdminProfile.user_id == uid).delete(synchronize_session=False)
            db.query(User).filter(User.id == uid).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _freeze_now(monkeypatch, iso="2030-06-10T08:00:00"):
    """Freeze the slot engine's clock to a Monday morning in the business timezone."""
    frozen = datetime.fromisoformat(iso).replace(tzinfo=ZoneInfo(settings.BUSINESS_TIMEZONE))

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return frozen.astimezone(tz) if tz else frozen.replace(tzinfo=None)

    monkeypatch.setattr(availability_api, "datetime", FrozenDatetime)


def _student(tracked, allocated=3):
    uid = uuid.uuid4().hex[:8]
    db = SessionLocal()
    try:
        u = User(name=f"Student {uid}", email=f"stud_{uid}@testdomain.com", password_hash=get_password_hash(PW),
                 role="student", status="ACTIVE", must_change_password=False)
        db.add(u)
        db.flush()
        db.add(StudentAllowance(student_id=u.id, allocated=allocated))
        db.commit()
        tracked.append(u.id)
        email, sid = u.email, u.id
    finally:
        db.close()
    r = client.post("/api/auth/login", json={"username_or_email": email, "password": PW})
    assert r.status_code == 200, r.text
    return {"id": sid, "headers": {"Authorization": f"Bearer {r.json()['access_token']}"}}


def _world(tracked, monkeypatch, *, rules, duration=20, audience="student_free", price=0, buffers=(0, 0), windows=None):
    """
    A throwaway Super Admin host with general working hours (`rules`) and one student meeting
    type. `windows` are the type's OWN hours ("Set specific hours"); None = general availability.
    """
    uid = uuid.uuid4().hex[:8]
    db = SessionLocal()
    try:
        host = User(name="Host", email=f"host_{uid}@testdomain.com", password_hash=get_password_hash(PW),
                    role="super_admin", status="ACTIVE")
        db.add(host)
        db.flush()
        db.add(AdminProfile(user_id=host.id, username=f"host{uid}"))
        for dow, start, end in rules:
            db.add(AvailabilityRule(admin_id=host.id, day_of_week=dow, start_time=start, end_time=end, is_active=True))
        sess = SessionModel(
            admin_id=host.id, title=f"{duration} min", duration_minutes=duration, price=price,
            audience=audience, is_active=True, buffer_before_minutes=buffers[0], buffer_after_minutes=buffers[1],
            min_advance_hours=1, max_advance_days=3650,
        )
        db.add(sess)
        db.flush()
        for dow, start, end in windows or []:
            db.add(SessionTimeWindow(session_id=sess.id, admin_id=host.id, day_of_week=dow, start_time=start, end_time=end))
        db.commit()
        tracked.append(host.id)
        host_id, session_id, host_email = host.id, sess.id, host.email
    finally:
        db.close()
    monkeypatch.setattr(student_portal, "get_student_host", lambda db: db.query(User).filter(User.id == host_id).first())
    return {"host_id": host_id, "session_id": session_id, "host_email": host_email}


def _host_headers(world):
    r = client.post("/api/auth/login", json={"username_or_email": world["host_email"], "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _availability(student, world, date=None, days=30):
    url = f"/api/student/availability?session_id={world['session_id']}&days={days}"
    if date:
        url += f"&date={date}"
    return client.get(url, headers=student["headers"])


def _starts(res):
    return [s["start"] for s in res.json()["slots"]]


def _iso(date, hhmm):
    return f"{date}T{hhmm}:00Z"


def _hold(world, date, start, end, fingerprint="fp"):
    return client.post("/api/bookings/hold-slot", json={
        "admin_id": world["host_id"], "session_id": world["session_id"],
        "start_time": _iso(date, start), "end_time": _iso(date, end), "session_fingerprint": fingerprint,
    })


def _book_free(student, world, date, start, end, lock_id):
    return client.post("/api/student/bookings/free", headers=student["headers"], json={
        "session_id": world["session_id"], "start_time": _iso(date, start),
        "end_time": _iso(date, end), "lock_id": lock_id,
    })


def _add_booking(world, date, start, end, *, category="client", student_id=None):
    db = SessionLocal()
    try:
        db.add(Booking(
            public_id=f"BK-{uuid.uuid4().hex[:6]}", admin_id=world["host_id"], student_id=student_id, category=category,
            client_name="x", client_email="x@y.com", start_time=_iso(date, start), end_time=_iso(date, end),
            status="confirmed", payment_status="completed", cancellation_token=uuid.uuid4().hex,
        ))
        db.commit()
    finally:
        db.close()


def _connect_google(world):
    db = SessionLocal()
    try:
        db.add(GoogleConnection(admin_id=world["host_id"], google_email="host@example.com",
                                encrypted_refresh_token="not-a-real-token", connection_status="connected"))
        db.commit()
    finally:
        db.close()


# --- availability + automatic next-available date ------------------------------------------

def test_slots_appear_for_today_and_today_is_selected(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    r = _availability(_student(tracked), world)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["selected_date"] == MONDAY and body["first_available_date"] == MONDAY
    assert body["requested_date_unavailable"] is False
    assert body["timezone"] == settings.BUSINESS_TIMEZONE
    assert body["days"][0] == {"date": MONDAY, "count": 6}


def test_a_20_minute_session_starts_every_20_minutes(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")], duration=20)
    r = _availability(_student(tracked), world)
    slots = r.json()["slots"]
    assert [s["start"] for s in slots] == ["10:00", "10:20", "10:40", "11:00", "11:20", "11:40"]
    assert [s["end"] for s in slots] == ["10:20", "10:40", "11:00", "11:20", "11:40", "12:00"]
    assert slots[0]["start_time_iso"] == _iso(MONDAY, "10:00") and slots[0]["end_time_iso"] == _iso(MONDAY, "10:20")


def test_longer_sessions_keep_the_half_hour_grid(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    for duration, expected in ((30, ["10:00", "10:30", "11:00", "11:30"]), (60, ["10:00", "10:30", "11:00"])):
        world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")], duration=duration)
        assert _starts(_availability(_student(tracked), world)) == expected


def test_today_empty_so_tomorrow_is_selected_automatically(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["tue"], "10:00", "12:00")])
    body = _availability(_student(tracked), world).json()
    assert body["days"][0]["count"] == 0
    assert body["selected_date"] == TUESDAY and body["first_available_date"] == TUESDAY
    assert body["slots"][0]["start"] == "10:00"

    # Asking for today explicitly says it is unavailable and moves to the next date.
    moved = _availability(_student(tracked), world, date=MONDAY).json()
    assert moved["requested_date_unavailable"] is True and moved["selected_date"] == TUESDAY


def test_a_later_date_is_found_when_the_next_days_are_empty(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["fri"], "14:00", "16:00")])
    body = _availability(_student(tracked), world).json()
    assert body["selected_date"] == FRIDAY
    assert [d["count"] for d in body["days"][:4]] == [0, 0, 0, 0]


def test_no_availability_in_the_horizon_is_reported_not_faked(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[])
    body = _availability(_student(tracked), world).json()
    assert body["first_available_date"] is None and body["selected_date"] is None and body["slots"] == []
    assert body["calendar"]["status"] == "disconnected"  # not an error: nothing is configured
    # ...and it says WHICH setting is missing instead of leaving an unexplained empty page.
    assert body["diagnosis"]["code"] == "no_working_hours"
    assert "working hours" in body["diagnosis"]["message"].lower()


def test_a_day_fully_booked_by_a_regular_client_is_skipped(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "10:40"), (DOW["tue"], "10:00", "10:40")])
    _add_booking(world, MONDAY, "10:00", "10:40", category="client")
    body = _availability(_student(tracked), world).json()
    assert body["days"][0]["count"] == 0 and body["selected_date"] == TUESDAY


def test_a_day_fully_booked_by_other_students_is_skipped(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "10:40"), (DOW["tue"], "10:00", "10:40")])
    other = _student(tracked)
    _add_booking(world, MONDAY, "10:00", "10:20", category="student_free", student_id=other["id"])
    _add_booking(world, MONDAY, "10:20", "10:40", category="student_paid", student_id=other["id"])
    body = _availability(_student(tracked), world).json()
    assert body["days"][0]["count"] == 0 and body["selected_date"] == TUESDAY


# --- Google Calendar -----------------------------------------------------------------------

def test_google_busy_time_blocks_a_day(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00"), (DOW["tue"], "10:00", "12:00")])
    _connect_google(world)

    async def busy_all_monday_morning(*args, **kwargs):  # 10:00-12:00 IST on Monday, as UTC instants
        return [{"start": "2030-06-10T04:30:00Z", "end": "2030-06-10T06:30:00Z"}]

    monkeypatch.setattr(availability_api, "get_google_busy_intervals", busy_all_monday_morning)
    body = _availability(_student(tracked), world).json()
    assert body["calendar"] == {"status": "connected", "checked": True}
    assert body["days"][0]["count"] == 0 and body["selected_date"] == TUESDAY


def test_a_calendar_failure_is_an_error_not_an_empty_list(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    _connect_google(world)

    async def broken(*args, **kwargs):
        raise GoogleCalendarUnavailable("token revoked")

    monkeypatch.setattr(availability_api, "get_google_busy_intervals", broken)
    body = _availability(_student(tracked), world).json()
    assert body["calendar"]["status"] == "error" and body["calendar"]["checked"] is False
    assert body["slots"] == [] and body["selected_date"] is None


def test_a_disconnected_calendar_is_flagged_as_unchecked(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    body = _availability(_student(tracked), world).json()
    assert body["calendar"] == {"status": "disconnected", "checked": False}
    assert len(body["slots"]) == 6  # availability still works; the page warns conflicts were not checked


# --- type rules + access -------------------------------------------------------------------

def test_an_inactive_type_is_neither_listed_nor_bookable(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    student = _student(tracked)
    db = SessionLocal()
    try:
        db.query(SessionModel).filter(SessionModel.id == world["session_id"]).update({SessionModel.is_active: False})
        db.commit()
    finally:
        db.close()
    assert _availability(student, world).status_code == 404
    assert _book_free(student, world, MONDAY, "10:00", "10:20", "nolock").status_code == 404


def test_a_public_type_is_not_a_student_type(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")], audience="public")
    assert _availability(_student(tracked), world).status_code == 404


def test_availability_needs_a_signed_in_student(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    assert client.get(f"/api/student/availability?session_id={world['session_id']}").status_code == 401


def test_zero_free_allowance_cannot_book_a_free_session(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    student = _student(tracked, allocated=0)
    hold = _hold(world, MONDAY, "10:00", "10:20")
    assert hold.status_code == 200
    r = _book_free(student, world, MONDAY, "10:00", "10:20", hold.json()["lock_id"])
    assert r.status_code == 402


# --- backend enforcement -------------------------------------------------------------------

def test_a_valid_free_booking_succeeds_with_a_server_computed_end(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    student = _student(tracked)
    hold = _hold(world, MONDAY, "10:20", "10:40")
    r = _book_free(student, world, MONDAY, "10:20", "10:40", hold.json()["lock_id"])
    assert r.status_code == 200, r.text
    db = SessionLocal()
    try:
        b = db.query(Booking).filter(Booking.id == r.json()["booking_id"]).first()
        assert b.start_time == _iso(MONDAY, "10:20") and b.end_time == _iso(MONDAY, "10:40")
        assert b.timezone == settings.BUSINESS_TIMEZONE  # the host's zone, not a hardcoded one
        assert b.category == "student_free" and b.student_id == student["id"]
        assert db.query(SlotLock).filter(SlotLock.id == hold.json()["lock_id"]).first().status == "confirmed"
    finally:
        db.close()


def test_a_time_outside_the_working_hours_is_refused_even_with_a_hold(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    student = _student(tracked)
    hold = _hold(world, MONDAY, "03:00", "03:20")  # hold-slot itself accepts anything
    assert hold.status_code == 200
    r = _book_free(student, world, MONDAY, "03:00", "03:20", hold.json()["lock_id"])
    assert r.status_code == 409


def test_a_wrong_duration_or_start_format_is_rejected(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    student = _student(tracked)
    hold = _hold(world, MONDAY, "10:00", "10:30")
    assert _book_free(student, world, MONDAY, "10:00", "10:30", hold.json()["lock_id"]).status_code == 400
    bad = client.post("/api/student/bookings/free", headers=student["headers"], json={
        "session_id": world["session_id"], "start_time": "2030-06-10 10:00", "end_time": "x", "lock_id": hold.json()["lock_id"]})
    assert bad.status_code in (400, 409)  # the lock is keyed on the exact start string
    # A refused attempt leaves the student's hold usable for a correct retry.
    assert _book_free(student, world, MONDAY, "10:00", "10:20", hold.json()["lock_id"]).status_code == 200


def test_a_slot_taken_between_display_and_confirmation_is_refused(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    student = _student(tracked)
    hold = _hold(world, MONDAY, "10:00", "10:20")
    _add_booking(world, MONDAY, "10:00", "10:30", category="client")  # a regular client takes it meanwhile
    r = _book_free(student, world, MONDAY, "10:00", "10:20", hold.json()["lock_id"])
    assert r.status_code == 409
    db = SessionLocal()
    try:  # nothing was booked for the student, and their hold was not consumed
        assert db.query(Booking).filter(Booking.student_id == student["id"]).count() == 0
        assert db.query(SlotLock).filter(SlotLock.id == hold.json()["lock_id"]).first().status == "active"
    finally:
        db.close()


def test_overlapping_a_regular_client_meeting_is_refused(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    student = _student(tracked)
    _add_booking(world, MONDAY, "10:30", "11:00", category="client")  # overlaps the 10:40-11:00 part
    hold = _hold(world, MONDAY, "10:40", "11:00")
    assert _book_free(student, world, MONDAY, "10:40", "11:00", hold.json()["lock_id"]).status_code == 409


def test_a_booking_is_refused_while_the_calendar_is_unreachable(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    _connect_google(world)

    async def broken(*args, **kwargs):
        raise GoogleCalendarUnavailable("down")

    monkeypatch.setattr(availability_api, "get_google_busy_intervals", broken)
    student = _student(tracked)
    hold = _hold(world, MONDAY, "10:00", "10:20")
    assert _book_free(student, world, MONDAY, "10:00", "10:20", hold.json()["lock_id"]).status_code == 503


def test_two_students_cannot_hold_or_book_the_same_slot(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    a, b = _student(tracked), _student(tracked)
    hold_a = _hold(world, MONDAY, "10:00", "10:20", fingerprint="a")
    assert hold_a.status_code == 200
    assert _hold(world, MONDAY, "10:00", "10:20", fingerprint="b").status_code == 409  # second hold refused
    assert _book_free(a, world, MONDAY, "10:00", "10:20", hold_a.json()["lock_id"]).status_code == 200

    # Even a request that reaches the insert after another student won is stopped by the
    # database's unique (host, start) index: one 200, one 409, never two bookings.
    db = SessionLocal()
    try:
        lock_b = SlotLock(admin_id=world["host_id"], session_id=world["session_id"], start_time=_iso(MONDAY, "10:00"),
                          end_time=_iso(MONDAY, "10:20"), locked_by_session="b",
                          expires_at=datetime.now(timezone.utc) + timedelta(minutes=10), status="active")
        db.add(lock_b)
        db.commit()
        lock_b_id = lock_b.id
    finally:
        db.close()

    async def skip_validation(db, host, session_obj, lock, start_time, end_time):
        return end_time  # simulates the race window: both requests passed validation

    monkeypatch.setattr(student_portal, "_validate_student_slot", skip_validation)
    monkeypatch.setattr(student_portal, "_conflict_check", lambda *args, **kwargs: None)
    assert _book_free(b, world, MONDAY, "10:00", "10:20", lock_b_id).status_code == 409
    db = SessionLocal()
    try:
        assert db.query(Booking).filter(Booking.admin_id == world["host_id"], Booking.start_time == _iso(MONDAY, "10:00")).count() == 1
    finally:
        db.close()


def test_a_paid_booking_is_validated_the_same_way(tracked, monkeypatch):
    monkeypatch.setattr(settings, "PAYMENTS_ALLOW_SIMULATION", True, raising=False)

    async def fake_order(**kwargs):
        return {"id": f"order_{uuid.uuid4().hex[:8]}", "simulated": True}

    monkeypatch.setattr(student_portal, "create_razorpay_order", fake_order)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")], audience="student_paid", price=50000)
    student = _student(tracked, allocated=0)  # paid sessions never use the free allowance

    def paid(start, end, lock_id):
        return client.post("/api/student/bookings/paid-order", headers=student["headers"], json={
            "session_id": world["session_id"], "start_time": _iso(MONDAY, start), "end_time": _iso(MONDAY, end), "lock_id": lock_id})

    outside = _hold(world, MONDAY, "03:00", "03:20")
    assert paid("03:00", "03:20", outside.json()["lock_id"]).status_code == 409
    wrong_len = _hold(world, MONDAY, "10:00", "10:50")
    assert paid("10:00", "10:50", wrong_len.json()["lock_id"]).status_code == 400
    # The 400 above left this student's hold active (nothing was consumed), so the same
    # browser session re-holds the slot and gets the same lock back.
    good = _hold(world, MONDAY, "10:00", "10:20")
    r = paid("10:00", "10:20", good.json()["lock_id"])
    assert r.status_code == 200, r.text
    assert r.json()["amount"] == 50000  # the host's configured price, not anything the browser sent
    db = SessionLocal()
    try:
        b = db.query(Booking).filter(Booking.id == r.json()["booking_id"]).first()
        assert b.status == "pending_payment" and b.category == "student_paid" and b.end_time == _iso(MONDAY, "10:20")
    finally:
        db.close()


# --- specific hours vs general hours, and explaining an empty calendar ---------------------

ALL_DAYS = range(7)


def test_specific_hours_are_clipped_to_the_working_hours(tracked, monkeypatch):
    """The screenshot's setup: type hours 10:00-23:00 every day, host works 09:00-18:00."""
    _freeze_now(monkeypatch)
    world = _world(
        tracked, monkeypatch, duration=20,
        rules=[(d, "09:00", "18:00") for d in ALL_DAYS],
        windows=[(d, "10:00", "23:00") for d in ALL_DAYS],
    )
    body = _availability(_student(tracked), world).json()
    starts = [s["start"] for s in body["slots"]]
    assert body["selected_date"] == MONDAY and body["diagnosis"] is None
    assert starts[0] == "10:00" and starts[-1] == "17:40"  # nothing before the type's hours or after the working hours
    assert len(starts) == 24 and "18:00" not in starts and "09:00" not in starts


def test_specific_hours_work_when_the_working_hours_are_wide_enough(tracked, monkeypatch):
    """10:00-23:00 with working hours that cover it: slots run the whole window."""
    _freeze_now(monkeypatch)
    world = _world(
        tracked, monkeypatch, duration=20,
        rules=[(d, "08:00", "23:30") for d in ALL_DAYS],
        windows=[(d, "10:00", "23:00") for d in ALL_DAYS],
    )
    starts = _starts(_availability(_student(tracked), world))
    assert starts[0] == "10:00" and starts[-1] == "22:40" and len(starts) == 39


def test_general_availability_mode_uses_the_working_hours(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "13:00", "14:00")], windows=None)
    assert _starts(_availability(_student(tracked), world)) == ["13:00", "13:20", "13:40"]


def test_type_hours_that_never_overlap_the_working_hours_are_explained(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(
        tracked, monkeypatch,
        rules=[(d, "06:00", "09:00") for d in ALL_DAYS],          # host works early mornings
        windows=[(d, "10:00", "23:00") for d in ALL_DAYS],         # the type is offered later
    )
    body = _availability(_student(tracked), world).json()
    assert body["slots"] == [] and body["first_available_date"] is None
    assert body["diagnosis"]["code"] == "hours_do_not_overlap"
    assert "10:00" not in body["diagnosis"]["message"]  # students get a plain sentence, not config detail

    health = client.get("/api/super-admin/student-types/health", headers=_host_headers(world)).json()
    issue = health["types"][0]["issue"]
    assert issue["code"] == "hours_do_not_overlap"
    assert "every day 10:00-23:00" in issue["message"] and "every day 06:00-09:00" in issue["message"]  # names both settings


def test_a_session_longer_than_any_window_is_explained(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, duration=30, rules=[(DOW["mon"], "10:00", "10:20")])
    body = _availability(_student(tracked), world).json()
    assert body["slots"] == [] and body["diagnosis"]["code"] == "duration_too_long"


def test_a_sound_but_full_calendar_has_no_misleading_diagnosis(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "10:40")])
    _add_booking(world, MONDAY, "10:00", "10:40", category="client")
    body = _availability(_student(tracked), world, days=1).json()
    assert body["first_available_date"] is None and body["diagnosis"] is None  # configured fine; simply full


def test_a_calendar_error_is_never_blamed_on_the_settings(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])  # sound configuration
    _connect_google(world)

    async def broken(*args, **kwargs):
        raise GoogleCalendarUnavailable("down")

    monkeypatch.setattr(availability_api, "get_google_busy_intervals", broken)
    body = _availability(_student(tracked), world).json()
    assert body["calendar"]["status"] == "error" and body["diagnosis"] is None


def test_the_super_admin_is_warned_before_students_hit_a_dead_end(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[])
    host = _host_headers(world)
    health = client.get("/api/super-admin/student-types/health", headers=host).json()
    assert health["students_book_you"] is True
    assert health["types"][0]["issue"]["code"] == "no_working_hours"
    assert "Settings > Availability" in health["types"][0]["issue"]["message"]

    # A student cannot read the Super Admin's configuration.
    assert client.get("/api/super-admin/student-types/health", headers=_student(tracked)["headers"]).status_code == 403
    assert client.get("/api/super-admin/student-types/health").status_code == 401


def test_the_health_check_says_when_students_book_a_different_super_admin(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    other = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    # `other` was created last, so students are pinned to it; `world`'s admin is not the host.
    health = client.get("/api/super-admin/student-types/health", headers=_host_headers(world)).json()
    assert health["students_book_you"] is False


def test_saving_working_hours_makes_slots_appear_on_the_student_page(tracked, monkeypatch):
    _freeze_now(monkeypatch)
    world = _world(tracked, monkeypatch, rules=[])
    student = _student(tracked)
    assert _availability(student, world).json()["diagnosis"]["code"] == "no_working_hours"

    saved = client.post("/api/availability/rules", headers=_host_headers(world), json={"rules": [
        {"day_of_week": DOW["mon"], "start_time": "10:00", "end_time": "11:00", "is_active": True}]})
    assert saved.status_code == 200, saved.text
    after = _availability(student, world).json()  # no cache: the very next request sees the change
    assert after["diagnosis"] is None and [s["start"] for s in after["slots"]] == ["10:00", "10:20", "10:40"]


def test_a_saved_student_type_round_trips_its_hours_and_audience(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(d, "08:00", "23:30") for d in ALL_DAYS])
    host = _host_headers(world)
    windows = [{"day_of_week": d, "start_time": "10:00", "end_time": "23:00"} for d in ALL_DAYS]
    created = client.post("/api/sessions/", headers=host, json={
        "title": "q&a", "duration_minutes": 20, "price": 0, "audience": "student_free",
        "max_advance_days": 60, "available_hours": windows})
    assert created.status_code == 200, created.text
    listed = {s["id"]: s for s in client.get("/api/sessions/", headers=host).json()}
    saved = listed[created.json()["id"]]
    assert saved["audience"] == "student_free" and saved["duration_minutes"] == 20
    assert sorted((w["day_of_week"], w["start_time"], w["end_time"]) for w in saved["available_hours"]) == \
        [(d, "10:00", "23:00") for d in ALL_DAYS]
    # ...and the student page offers it, drawing on those saved hours.
    student = _student(tracked)
    types = client.get("/api/student/meeting-types", headers=student["headers"]).json()
    assert created.json()["id"] in [t["id"] for t in types["free"]]
    world["session_id"] = created.json()["id"]
    assert _starts(_availability(student, world, date=MONDAY)) not in ([], None)


# --- the public booking facts the confirmation page states ---------------------------------

def _public(public_id):
    r = client.get(f"/api/bookings/public/{public_id}")
    assert r.status_code == 200, r.text
    return r.json()


def test_a_free_student_booking_reports_that_nothing_was_paid(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")])
    student = _student(tracked)
    hold = _hold(world, MONDAY, "10:00", "10:20")
    booked = _book_free(student, world, MONDAY, "10:00", "10:20", hold.json()["lock_id"])
    assert booked.status_code == 200, booked.text
    body = _public(booked.json()["public_id"])
    assert body["category"] == "student_free"
    assert body["payment_status"] == "free" and body["amount"] == 0  # no money moved
    assert body["google_meet_link"] is None  # no calendar connected: the page must not claim a link
    assert body["email_enabled"] is settings.EMAIL_ENABLED  # promise an email only if one can be sent


def test_a_paid_booking_reports_the_amount_that_was_charged(tracked, monkeypatch):
    world = _world(tracked, monkeypatch, rules=[(DOW["mon"], "10:00", "12:00")], audience="student_paid", price=50000)
    db = SessionLocal()
    try:
        b = Booking(public_id=f"BK-{uuid.uuid4().hex[:6]}", admin_id=world["host_id"], category="client",
                    meeting_type_id=world["session_id"], client_name="x", client_email="x@y.com",
                    start_time=_iso(MONDAY, "11:00"), end_time=_iso(MONDAY, "11:20"), status="confirmed",
                    payment_status="completed", cancellation_token=uuid.uuid4().hex)
        db.add(b)
        db.flush()
        db.add(Payment(booking_id=b.id, admin_id=world["host_id"], provider="razorpay", order_id="order_x",
                       amount=50000, currency="INR", status="captured"))
        db.commit()
        public_id = b.public_id
    finally:
        db.close()
    body = _public(public_id)
    assert body["category"] == "client" and body["payment_status"] == "completed"
    assert body["amount"] == 50000 and body["currency"] == "INR"
