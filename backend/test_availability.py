"""
Tests for availability persistence and the slots it feeds.

These cover the bug this suite was written for: hours saved by an admin were not coming back
on reload, and the booking page produced no slots for them. Both had the same shape — the
page's state and the database had drifted apart — so the tests assert the round trip
(save -> reload -> slots) rather than any single layer.

Rows are created and torn down per test, in the manner of test_admin_deletion.py.
"""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.core.database import SessionLocal
from app.models.models import (
    User,
    AdminProfile,
    Session as SessionModel,
    AvailabilityRule,
    AvailabilityException,
    Booking,
    GoogleConnection,
)
from app.services import google_calendar as google_service
from app.api import availability as availability_api

seed_initial_data()
client = TestClient(app)

PASSWORD = "TestPassw0rd!123"

# 2030-06-10 is a Monday; day_of_week 1 in this schema (0 = Sunday).
MONDAY = "2030-06-10"
TUESDAY = "2030-06-11"
NEXT_MONDAY = "2030-06-17"


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def tracked():
    ids = []
    yield ids

    session = SessionLocal()
    try:
        for user_id in ids:
            session.query(Booking).filter(Booking.admin_id == user_id).delete(synchronize_session=False)
            session.query(GoogleConnection).filter(GoogleConnection.admin_id == user_id).delete(synchronize_session=False)
            session.query(AvailabilityException).filter(AvailabilityException.admin_id == user_id).delete(synchronize_session=False)
            session.query(AvailabilityRule).filter(AvailabilityRule.admin_id == user_id).delete(synchronize_session=False)
            session.query(SessionModel).filter(SessionModel.admin_id == user_id).delete(synchronize_session=False)
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _make_admin(tracked, tag="a"):
    uid = uuid.uuid4().hex[:8]
    email = f"avail_{tag}_{uid}@testdomain.com"
    username = f"avail{tag}{uid}"
    res = client.post("/api/auth/signup", json={
        "name": f"Availability {tag}",
        "email": email,
        "password": PASSWORD,
        "username": username,
    })
    assert res.status_code == 200, res.text
    data = res.json()
    tracked.append(data["user_id"])

    profile = client.get(f"/api/profiles/public/{username}").json()
    return {
        "id": data["user_id"],
        "email": email,
        "username": username,
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
        "session_id": profile["sessions"][0]["id"],
    }


@pytest.fixture
def admin(tracked):
    return _make_admin(tracked, "a")


def _save(admin, ranges):
    """ranges: list of (day_of_week, start, end)."""
    return client.post("/api/availability/rules", headers=admin["headers"], json={
        "rules": [
            {"day_of_week": d, "start_time": s, "end_time": e, "is_active": True}
            for d, s, e in ranges
        ]
    })


def _slots(admin, date_str=MONDAY):
    res = client.get(
        f"/api/availability/slots?admin_id={admin['id']}&session_id={admin['session_id']}&date_str={date_str}"
    )
    return res.json()


def _starts(admin, date_str=MONDAY):
    return [s["start"] for s in _slots(admin, date_str).get("available_slots", [])]


# --------------------------------------------------------------------------------------
# A / B / C — save, load, and survive a reload
# --------------------------------------------------------------------------------------

def test_saved_availability_is_persisted_and_loads_back(admin, db):
    assert _save(admin, [(1, "09:00", "17:00")]).status_code == 200

    # Straight from the database, not from any client-side cache.
    rows = db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == admin["id"]).all()
    assert [(r.day_of_week, r.start_time, r.end_time) for r in rows] == [(1, "09:00", "17:00")]

    # And back through the API the page reads on mount.
    reloaded = client.get("/api/availability/rules", headers=admin["headers"]).json()
    assert [(r["day_of_week"], r["start_time"], r["end_time"]) for r in reloaded] == [
        (1, "09:00", "17:00")
    ]


def test_availability_survives_a_fresh_session(tracked, admin):
    """Signing in again must return the same hours — the reload path the bug broke."""
    _save(admin, [(1, "10:00", "16:00")])

    login = client.post("/api/auth/login", json={
        "username_or_email": admin["email"], "password": PASSWORD,
    })
    assert login.status_code == 200
    fresh = {"Authorization": f"Bearer {login.json()['access_token']}"}

    rules = client.get("/api/availability/rules", headers=fresh).json()
    assert [(r["start_time"], r["end_time"]) for r in rules] == [("10:00", "16:00")]


def test_times_are_stored_canonically_whatever_the_client_sends(admin, db):
    """
    The page used to append ":00" before posting. The slot engine parses "%H:%M", so those
    rows produced no slots. Seconds are now normalised away on the way in.
    """
    res = client.post("/api/availability/rules", headers=admin["headers"], json={
        "rules": [{"day_of_week": 1, "start_time": "09:00:00", "end_time": "17:00:00", "is_active": True}]
    })
    assert res.status_code == 200

    row = db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == admin["id"]).one()
    assert (row.start_time, row.end_time) == ("09:00", "17:00")
    assert _starts(admin), "canonical times must still produce bookable slots"


# --------------------------------------------------------------------------------------
# D — several ranges on one day
# --------------------------------------------------------------------------------------

def test_two_ranges_on_one_day_both_persist_and_produce_slots(admin):
    """The engine took `.first()`, so an afternoon window was silently dropped."""
    assert _save(admin, [(1, "09:00", "13:00"), (1, "14:00", "17:00")]).status_code == 200

    reloaded = client.get("/api/availability/rules", headers=admin["headers"]).json()
    assert len(reloaded) == 2

    starts = _starts(admin)
    assert any(s < "13:00" for s in starts), "morning window missing"
    assert any(s >= "14:00" for s in starts), "afternoon window missing"
    # The gap between the windows is not bookable.
    assert not [s for s in starts if "13:00" <= s < "14:00"]


def test_adding_a_second_range_keeps_the_first(admin):
    """The exact scenario from the report: save, add another range, save, reload."""
    _save(admin, [(1, "09:00", "13:00")])
    _save(admin, [(1, "09:00", "13:00"), (1, "14:00", "17:00")])

    reloaded = client.get("/api/availability/rules", headers=admin["headers"]).json()
    assert sorted((r["start_time"], r["end_time"]) for r in reloaded) == [
        ("09:00", "13:00"),
        ("14:00", "17:00"),
    ]


# --------------------------------------------------------------------------------------
# E — unavailable ranges
# --------------------------------------------------------------------------------------

def test_partial_day_block_subtracts_from_working_hours(admin):
    _save(admin, [(1, "09:00", "17:00")])
    before = _starts(admin)
    assert any("11:00" <= s < "12:00" for s in before)

    res = client.post("/api/availability/exceptions", headers=admin["headers"], json={
        "exception_date": MONDAY, "start_time": "11:00", "end_time": "12:00", "reason": "Lunch",
    })
    assert res.status_code == 200

    after = _starts(admin)
    assert not [s for s in after if "11:00" <= s < "12:00"], "blocked window still bookable"
    assert any(s < "11:00" for s in after) and any(s >= "12:00" for s in after)


def test_whole_day_block_clears_the_day(admin):
    _save(admin, [(1, "09:00", "17:00")])
    client.post("/api/availability/exceptions", headers=admin["headers"], json={
        "exception_date": NEXT_MONDAY, "reason": "Leave",
    })

    body = _slots(admin, NEXT_MONDAY)
    assert body["available_slots"] == []
    assert "leave" in body["message"].lower()
    # A different Monday is unaffected.
    assert _starts(admin, MONDAY)


def test_blocked_dates_round_trip_and_can_be_removed(admin):
    _save(admin, [(1, "09:00", "17:00")])
    created = client.post("/api/availability/exceptions", headers=admin["headers"], json={
        "exception_date": NEXT_MONDAY, "reason": "Conference",
    }).json()

    listed = client.get("/api/availability/exceptions", headers=admin["headers"]).json()
    assert [e["exception_date"] for e in listed] == [NEXT_MONDAY]

    assert client.delete(
        f"/api/availability/exceptions/{created['id']}", headers=admin["headers"]
    ).status_code == 200
    assert client.get("/api/availability/exceptions", headers=admin["headers"]).json() == []


def test_exception_endpoints_reject_a_half_specified_window(admin):
    res = client.post("/api/availability/exceptions", headers=admin["headers"], json={
        "exception_date": MONDAY, "start_time": "11:00",
    })
    assert res.status_code == 400


# --------------------------------------------------------------------------------------
# F / G — slots come from saved availability, per admin
# --------------------------------------------------------------------------------------

def test_no_configured_hours_means_no_slots_and_no_invented_defaults(admin):
    """A weekday the admin never configured must not be offered to clients."""
    _save(admin, [(1, "09:00", "17:00")])

    body = _slots(admin, TUESDAY)
    assert body["available_slots"] == []
    assert "no working hours" in body["message"].lower()


def test_slots_follow_the_saved_window(admin):
    _save(admin, [(1, "14:00", "16:00")])
    starts = _starts(admin)

    assert starts, "saved hours produced no slots"
    assert min(starts) >= "14:00"
    assert max(starts) < "16:00"


def test_availability_is_isolated_per_admin(tracked, admin):
    other = _make_admin(tracked, "b")
    _save(admin, [(1, "09:00", "12:00")])
    _save(other, [(1, "15:00", "18:00")])

    mine = _starts(admin)
    theirs = _starts(other)

    assert mine and max(mine) < "12:00"
    assert theirs and min(theirs) >= "15:00"
    assert not set(mine) & set(theirs)


def test_saving_does_not_touch_another_admins_rules(tracked, admin, db):
    other = _make_admin(tracked, "c")
    _save(other, [(1, "15:00", "18:00")])

    _save(admin, [(1, "09:00", "12:00")])

    still_there = db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == other["id"]).all()
    assert [(r.start_time, r.end_time) for r in still_there] == [("15:00", "18:00")]


# --------------------------------------------------------------------------------------
# H — existing bookings still block
# --------------------------------------------------------------------------------------

def test_existing_booking_blocks_its_slot(admin, db):
    _save(admin, [(1, "09:00", "17:00")])
    assert "10:00" in _starts(admin)

    db.add(Booking(
        public_id=f"BK-AV-{uuid.uuid4().hex[:6].upper()}",
        admin_id=admin["id"],
        meeting_type_id=admin["session_id"],
        client_name="Existing Client",
        client_email="client@example.com",
        start_time=f"{MONDAY}T10:00:00Z",
        end_time=f"{MONDAY}T10:30:00Z",
        status="confirmed",
        payment_status="completed",
        cancellation_token=uuid.uuid4().hex,
    ))
    db.commit()

    assert "10:00" not in _starts(admin), "an existing booking must not be offered again"


# --------------------------------------------------------------------------------------
# I / J — Google Calendar keeps blocking, and failure stays fail-closed
# --------------------------------------------------------------------------------------

def test_google_busy_periods_block_slots(monkeypatch, admin, db):
    _save(admin, [(1, "09:00", "17:00")])
    db.add(GoogleConnection(
        admin_id=admin["id"],
        google_email=admin["email"],
        encrypted_refresh_token="ciphertext",
        connection_status="connected",
    ))
    db.commit()

    async def fake_busy(*args, **kwargs):
        # 09:30-10:30 IST expressed as the real UTC instants Google would return.
        return [{"start": f"{MONDAY}T04:00:00Z", "end": f"{MONDAY}T05:00:00Z"}]

    monkeypatch.setattr(availability_api, "get_google_busy_intervals", fake_busy)

    starts = _starts(admin)
    assert starts, "the rest of the day should still be bookable"
    assert "09:30" not in starts and "10:00" not in starts


def test_unreadable_calendar_fails_closed(monkeypatch, admin, db):
    """
    A calendar we cannot read must never be reported as a free day — that is how a client
    books over a real meeting. This guards a regression that briefly shipped.
    """
    _save(admin, [(1, "09:00", "17:00")])
    db.add(GoogleConnection(
        admin_id=admin["id"],
        google_email=admin["email"],
        encrypted_refresh_token="ciphertext",
        connection_status="connected",
    ))
    db.commit()

    async def failing(*args, **kwargs):
        raise google_service.GoogleCalendarUnavailable("token revoked")

    monkeypatch.setattr(availability_api, "get_google_busy_intervals", failing)

    body = _slots(admin)
    assert body["available_slots"] == []
    assert body.get("calendar_error") is True


# --------------------------------------------------------------------------------------
# K — a failed save must not look like a successful one
# --------------------------------------------------------------------------------------

def test_unauthenticated_save_is_refused(admin, db):
    before = db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == admin["id"]).count()

    res = client.post("/api/availability/rules", json={
        "rules": [{"day_of_week": 1, "start_time": "09:00", "end_time": "17:00", "is_active": True}]
    })
    assert res.status_code == 401

    after = db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == admin["id"]).count()
    assert after == before, "a refused save must not change stored availability"


@pytest.mark.parametrize("bad", [
    {"day_of_week": 1, "start_time": "17:00", "end_time": "09:00", "is_active": True},
    {"day_of_week": 1, "start_time": "notatime", "end_time": "17:00", "is_active": True},
    {"day_of_week": 9, "start_time": "09:00", "end_time": "17:00", "is_active": True},
])
def test_invalid_ranges_are_rejected_and_nothing_is_stored(admin, db, bad):
    """A rejected save must leave the admin's existing hours exactly as they were."""
    _save(admin, [(1, "09:00", "17:00")])
    before = [
        (r.day_of_week, r.start_time, r.end_time)
        for r in db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == admin["id"]).all()
    ]

    res = client.post("/api/availability/rules", headers=admin["headers"], json={"rules": [bad]})
    assert res.status_code == 400, res.text

    db.expire_all()
    after = [
        (r.day_of_week, r.start_time, r.end_time)
        for r in db.query(AvailabilityRule).filter(AvailabilityRule.admin_id == admin["id"]).all()
    ]
    assert after == before, "a rejected save wiped existing availability"
