"""
Tests for a meeting type's own bookable hours (session_time_windows).

The rule under test: public slots are the intersection of the admin's working hours with the
session's window, minus Google busy time, bookings and every other existing rule. A session
without a window keeps using the admin's general availability.

Fixed 2030 dates keep the weekday mapping deterministic. Rows are created and torn down per test.
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
    SessionTimeWindow,
    AvailabilityRule,
    Booking,
    GoogleConnection,
    SlotLock,
)
from app.api import availability as availability_api

seed_initial_data()
client = TestClient(app)

PASSWORD = "TestPassw0rd!123"
MONDAY = "2030-06-10"   # day_of_week 1
TUESDAY = "2030-06-11"  # day_of_week 2


@pytest.fixture
def tracked():
    ids = []
    yield ids
    session = SessionLocal()
    try:
        for user_id in ids:
            for model in (SlotLock, Booking, GoogleConnection, AvailabilityRule, SessionTimeWindow, SessionModel):
                session.query(model).filter(model.admin_id == user_id).delete(synchronize_session=False)
            session.query(AdminProfile).filter(AdminProfile.user_id == user_id).delete(synchronize_session=False)
            session.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        session.commit()
    finally:
        session.close()


def _make_admin(tracked, tag="a"):
    uid = uuid.uuid4().hex[:8]
    email = f"hours_{tag}_{uid}@testdomain.com"
    res = client.post("/api/auth/signup", json={
        "name": f"Hours {tag}", "email": email, "password": PASSWORD, "username": f"hours{tag}{uid}",
    })
    assert res.status_code == 200, res.text
    data = res.json()
    tracked.append(data["user_id"])
    return {
        "id": data["user_id"],
        "email": email,
        "headers": {"Authorization": f"Bearer {data['access_token']}"},
    }


@pytest.fixture
def admin(tracked):
    return _make_admin(tracked)


def _hours(admin, ranges):
    res = client.post("/api/availability/rules", headers=admin["headers"], json={
        "rules": [{"day_of_week": d, "start_time": s, "end_time": e, "is_active": True} for d, s, e in ranges]
    })
    assert res.status_code == 200, res.text


def _session(admin, available_hours=None, duration=60, buffers=0, expect=200):
    body = {
        "title": "Consultation", "description": "", "duration_minutes": duration,
        "price": 99900, "currency": "INR", "is_active": True, "max_advance_days": 3650,
    }
    if buffers is not None:
        body.update(buffer_before_minutes=buffers, buffer_after_minutes=buffers)
    if available_hours is not None:
        body["available_hours"] = available_hours
    res = client.post("/api/sessions/", headers=admin["headers"], json=body)
    assert res.status_code == expect, res.text
    return res.json()


def _window(start, end, days=(1,)):
    return [{"day_of_week": d, "start_time": start, "end_time": end} for d in days]


def _slots(admin, session_id, date_str=MONDAY):
    res = client.get(f"/api/availability/slots?admin_id={admin['id']}&session_id={session_id}&date_str={date_str}")
    assert res.status_code == 200, res.text
    return [(s["start"], s["end"]) for s in res.json()["available_slots"]]


# ---------------------------------------------------------------------------------------
# Slot calculation
# ---------------------------------------------------------------------------------------

def test_1_slots_stay_inside_the_session_window(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "14:00"))
    slots = _slots(admin, s["id"])
    assert slots == [("10:00", "11:00"), ("10:30", "11:30"), ("11:00", "12:00"), ("11:30", "12:30"),
                     ("12:00", "13:00"), ("12:30", "13:30"), ("13:00", "14:00")]


def test_2_window_cannot_open_hours_the_admin_does_not_work(admin):
    _hours(admin, [(1, "09:00", "12:00")])
    s = _session(admin, _window("10:00", "14:00"))
    slots = _slots(admin, s["id"])
    assert slots and all(start >= "10:00" and end <= "12:00" for start, end in slots)


def test_3_google_busy_time_still_blocks_inside_the_window(monkeypatch, admin, tracked):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "14:00"))
    db = SessionLocal()
    try:
        db.add(GoogleConnection(admin_id=admin["id"], google_email=admin["email"],
                                encrypted_refresh_token="ciphertext", connection_status="connected"))
        db.commit()
    finally:
        db.close()

    async def fake_busy(*args, **kwargs):
        # 11:00-12:00 IST as real UTC.
        return [{"start": f"{MONDAY}T05:30:00Z", "end": f"{MONDAY}T06:30:00Z"}]

    monkeypatch.setattr(availability_api, "get_google_busy_intervals", fake_busy)
    slots = _slots(admin, s["id"])
    assert slots
    for start, end in slots:
        assert end <= "11:00" or start >= "12:00", (start, end)
    assert ("10:00", "11:00") in slots and ("12:00", "13:00") in slots


def test_4_last_slot_ends_exactly_at_the_window_end(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "14:00"), duration=60)
    slots = _slots(admin, s["id"])
    assert ("13:00", "14:00") in slots
    assert ("13:30", "14:30") not in slots


def test_5_no_window_uses_general_availability(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin)
    assert s["available_hours"] is None
    slots = _slots(admin, s["id"])
    assert slots[0] == ("09:00", "10:00") and slots[-1] == ("17:00", "18:00")


def test_existing_bookings_still_block_inside_the_window(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "14:00"))
    db = SessionLocal()
    try:
        db.add(Booking(
            public_id=f"BK-SH-{uuid.uuid4().hex[:6].upper()}", admin_id=admin["id"],
            meeting_type_id=s["id"], client_name="C", client_email="c@example.com",
            start_time=f"{MONDAY}T12:00:00Z", end_time=f"{MONDAY}T13:00:00Z",
            status="confirmed", payment_status="completed", cancellation_token=uuid.uuid4().hex,
        ))
        db.commit()
    finally:
        db.close()
    for start, end in _slots(admin, s["id"]):
        assert end <= "12:00" or start >= "13:00"


def test_default_buffers_still_apply_when_not_sent(admin):
    """The form no longer shows buffers; the stored defaults keep protecting adjacent time."""
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "14:00"), buffers=None)
    assert s["buffer_before_minutes"] == 5 and s["buffer_after_minutes"] == 10
    db = SessionLocal()
    try:
        db.add(Booking(
            public_id=f"BK-SB-{uuid.uuid4().hex[:6].upper()}", admin_id=admin["id"],
            meeting_type_id=s["id"], client_name="C", client_email="c@example.com",
            start_time=f"{MONDAY}T12:00:00Z", end_time=f"{MONDAY}T13:00:00Z",
            status="confirmed", payment_status="completed", cancellation_token=uuid.uuid4().hex,
        ))
        db.commit()
    finally:
        db.close()
    starts = [start for start, _ in _slots(admin, s["id"])]
    assert "11:00" not in starts  # 11:00-12:00 plus a 10-minute buffer touches the booking


def test_per_day_windows_and_days_without_one(admin):
    _hours(admin, [(1, "09:00", "18:00"), (2, "09:00", "18:00"), (3, "09:00", "18:00")])
    s = _session(admin, [
        {"day_of_week": 1, "start_time": "10:00", "end_time": "12:00"},
        {"day_of_week": 2, "start_time": "15:00", "end_time": "17:00"},
    ])
    assert _slots(admin, s["id"], MONDAY) == [("10:00", "11:00"), ("10:30", "11:30"), ("11:00", "12:00")]
    assert _slots(admin, s["id"], TUESDAY) == [("15:00", "16:00"), ("15:30", "16:30"), ("16:00", "17:00")]
    # Wednesday is a working day, but this session has no window on it.
    assert _slots(admin, s["id"], "2030-06-12") == []


def test_two_sessions_are_restricted_independently(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    quick = _session(admin, _window("10:00", "12:00"))
    premium = _session(admin, _window("14:00", "17:00"))
    assert all(end <= "12:00" for _, end in _slots(admin, quick["id"]))
    assert all(start >= "14:00" for start, _ in _slots(admin, premium["id"]))


# ---------------------------------------------------------------------------------------
# Validation and persistence
# ---------------------------------------------------------------------------------------

def test_end_before_start_is_rejected(admin):
    res = _session(admin, _window("14:00", "10:00"), expect=400)
    assert "after start" in res["detail"]


def test_malformed_time_is_rejected(admin):
    _session(admin, _window("25:99", "10:00"), expect=400)


def test_start_equal_to_end_is_rejected(admin):
    res = _session(admin, _window("10:00", "10:00"), expect=400)
    assert "after start" in res["detail"]


def test_overlapping_windows_on_one_day_are_rejected(admin):
    res = _session(admin, _window("10:00", "12:00") + _window("11:00", "13:00"), expect=400)
    assert "cannot overlap" in res["detail"]


def test_identical_windows_on_one_day_are_rejected(admin):
    res = _session(admin, _window("10:00", "12:00") + _window("10:00", "12:00"), expect=400)
    assert "listed twice" in res["detail"]


def test_windows_may_touch_and_are_not_merged(admin):
    s = _session(admin, _window("10:00", "12:00") + _window("12:00", "13:00"))
    assert s["available_hours"] == _window("10:00", "12:00") + _window("12:00", "13:00")


def test_too_many_windows_on_one_day_are_rejected(admin):
    many = [w for h in range(8, 19) for w in _window(f"{h:02d}:00", f"{h:02d}:30")]  # 11 windows
    res = _session(admin, many, expect=400)
    assert "at most" in res["detail"]


def test_a_rejected_window_list_writes_nothing(admin):
    s = _session(admin, _window("10:00", "12:00"))
    res = client.put(f"/api/sessions/{s['id']}", headers=admin["headers"],
                     json={"available_hours": _window("10:00", "12:00") + _window("11:00", "13:00")})
    assert res.status_code == 400
    assert client.get("/api/sessions/", headers=admin["headers"]).json()[0]["available_hours"] == _window("10:00", "12:00")


# ---------------------------------------------------------------------------------------
# Several windows on one day
# ---------------------------------------------------------------------------------------

def test_two_windows_offer_nothing_in_the_gap(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "12:00") + _window("16:00", "17:00"), duration=30)
    assert _slots(admin, s["id"]) == [
        ("10:00", "10:30"), ("10:30", "11:00"), ("11:00", "11:30"), ("11:30", "12:00"),
        ("16:00", "16:30"), ("16:30", "17:00"),
    ]


def test_three_windows(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "11:00") + _window("14:00", "15:00") + _window("16:00", "17:00"))
    assert _slots(admin, s["id"]) == [("10:00", "11:00"), ("14:00", "15:00"), ("16:00", "17:00")]


def test_windows_are_stored_and_returned_in_order(admin):
    s = _session(admin, _window("16:00", "17:00", days=(2,)) + _window("16:00", "17:00") + _window("10:00", "12:00"))
    assert s["available_hours"] == (
        _window("10:00", "12:00") + _window("16:00", "17:00") + _window("16:00", "17:00", days=(2,))
    )


def test_meeting_may_not_run_past_a_window_end(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "12:00") + _window("16:00", "17:00"), duration=45)
    slots = _slots(admin, s["id"])
    assert all(end <= "12:00" or start >= "16:00" for start, end in slots)
    assert all(end <= "17:00" for _, end in slots)
    assert ("11:00", "11:45") in slots and ("11:30", "12:15") not in slots
    assert ("16:00", "16:45") in slots and ("16:30", "17:15") not in slots


def test_duration_longer_than_a_window_skips_that_window(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "12:00") + _window("16:00", "17:00"), duration=90)
    assert _slots(admin, s["id"]) == [("10:00", "11:30"), ("10:30", "12:00")]


def test_window_wholly_outside_working_hours_offers_nothing(admin):
    _hours(admin, [(1, "09:00", "13:00")])
    s = _session(admin, _window("10:00", "12:00") + _window("16:00", "17:00"))
    assert _slots(admin, s["id"]) == [("10:00", "11:00"), ("10:30", "11:30"), ("11:00", "12:00")]


def test_google_busy_and_bookings_block_inside_several_windows(monkeypatch, admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "12:00") + _window("16:00", "17:00"), duration=30)
    db = SessionLocal()
    try:
        db.add(GoogleConnection(admin_id=admin["id"], google_email=admin["email"],
                                encrypted_refresh_token="ciphertext", connection_status="connected"))
        db.add(Booking(
            public_id=f"BK-MW-{uuid.uuid4().hex[:6].upper()}", admin_id=admin["id"],
            meeting_type_id=s["id"], client_name="C", client_email="c@example.com",
            start_time=f"{MONDAY}T16:00:00Z", end_time=f"{MONDAY}T16:30:00Z",
            status="confirmed", payment_status="completed", cancellation_token=uuid.uuid4().hex,
        ))
        db.commit()
    finally:
        db.close()

    async def fake_busy(*args, **kwargs):
        # 10:30-11:00 IST as real UTC.
        return [{"start": f"{MONDAY}T05:00:00Z", "end": f"{MONDAY}T05:30:00Z"}]

    monkeypatch.setattr(availability_api, "get_google_busy_intervals", fake_busy)
    assert _slots(admin, s["id"]) == [("10:00", "10:30"), ("11:00", "11:30"), ("11:30", "12:00"), ("16:30", "17:00")]


def test_calendar_outage_still_fails_closed_with_windows(monkeypatch, admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "12:00") + _window("16:00", "17:00"))
    db = SessionLocal()
    try:
        db.add(GoogleConnection(admin_id=admin["id"], google_email=admin["email"],
                                encrypted_refresh_token="ciphertext", connection_status="connected"))
        db.commit()
    finally:
        db.close()

    async def down(*args, **kwargs):
        raise availability_api.GoogleCalendarUnavailable("down")

    monkeypatch.setattr(availability_api, "get_google_busy_intervals", down)
    assert _slots(admin, s["id"]) == []


def test_per_day_multiple_windows(admin):
    _hours(admin, [(1, "09:00", "18:00"), (2, "09:00", "18:00"), (3, "09:00", "18:00")])
    s = _session(admin, [
        {"day_of_week": 1, "start_time": "10:00", "end_time": "11:00"},
        {"day_of_week": 1, "start_time": "16:00", "end_time": "17:00"},
        {"day_of_week": 2, "start_time": "09:00", "end_time": "10:00"},
        {"day_of_week": 2, "start_time": "14:00", "end_time": "15:00"},
    ])
    assert _slots(admin, s["id"], MONDAY) == [("10:00", "11:00"), ("16:00", "17:00")]
    assert _slots(admin, s["id"], TUESDAY) == [("09:00", "10:00"), ("14:00", "15:00")]
    assert _slots(admin, s["id"], "2030-06-12") == []


def test_single_window_row_written_before_this_change_still_works(admin):
    """Existing sessions have exactly one row per weekday; that is one window, unchanged."""
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin)
    db = SessionLocal()
    try:
        db.add(SessionTimeWindow(session_id=s["id"], admin_id=admin["id"], day_of_week=1,
                                 start_time="10:00", end_time="14:00"))
        db.commit()
    finally:
        db.close()
    listed = client.get("/api/sessions/", headers=admin["headers"]).json()[0]
    assert listed["available_hours"] == _window("10:00", "14:00")
    assert _slots(admin, s["id"])[0] == ("10:00", "11:00") and _slots(admin, s["id"])[-1] == ("13:00", "14:00")
    # Saving an unrelated field keeps it exactly as it was.
    client.put(f"/api/sessions/{s['id']}", headers=admin["headers"], json={"title": "Renamed"})
    assert client.get("/api/sessions/", headers=admin["headers"]).json()[0]["available_hours"] == _window("10:00", "14:00")


def test_multiple_windows_survive_a_new_login(admin):
    hours = _window("10:00", "12:00", days=(1, 2)) + _window("16:00", "17:00", days=(1, 2))
    s = _session(admin, hours)
    login = client.post("/api/auth/login", json={"username_or_email": admin["email"], "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    listed = client.get("/api/sessions/", headers=headers).json()
    expected = sorted(hours, key=lambda w: (w["day_of_week"], w["start_time"]))
    assert [x for x in listed if x["id"] == s["id"]][0]["available_hours"] == expected


def test_public_page_shows_slots_not_windows_and_a_slot_can_be_held(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "12:00") + _window("16:00", "17:00"), duration=30)
    db = SessionLocal()
    try:
        username = db.query(AdminProfile).filter(AdminProfile.user_id == admin["id"]).first().username
    finally:
        db.close()
    public = client.get(f"/api/profiles/public/{username}").json()
    session = [x for x in public["sessions"] if x["id"] == s["id"]][0]
    assert "available_hours" not in session

    res = client.get(f"/api/availability/slots?admin_id={admin['id']}&session_id={s['id']}&date_str={MONDAY}")
    slot = [x for x in res.json()["available_slots"] if x["start"] == "16:00"][0]
    hold = client.post("/api/bookings/hold-slot", json={
        "admin_id": admin["id"], "session_id": s["id"], "start_time": slot["start_time_iso"],
        "end_time": slot["end_time_iso"], "session_fingerprint": "fp-windows",
    })
    assert hold.status_code == 200, hold.text
    # The held slot leaves the list; the rest of both windows is still offered.
    starts = [start for start, _ in _slots(admin, s["id"])]
    assert "16:00" not in starts and "10:00" in starts and "16:30" in starts


def test_hours_round_trip_and_survive_a_new_login(admin):
    s = _session(admin, _window("10:00", "14:00", days=(1, 2, 3)))
    assert s["available_hours"] == _window("10:00", "14:00", days=(1, 2, 3))
    login = client.post("/api/auth/login", json={"username_or_email": admin["email"], "password": PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    listed = client.get("/api/sessions/", headers=headers).json()
    assert listed[0]["available_hours"] == _window("10:00", "14:00", days=(1, 2, 3))


def test_toggling_active_leaves_the_hours_alone(admin):
    s = _session(admin, _window("10:00", "14:00"))
    res = client.put(f"/api/sessions/{s['id']}", headers=admin["headers"], json={"is_active": False})
    assert res.json()["available_hours"] == _window("10:00", "14:00")


def test_clearing_hours_returns_to_general_availability(admin):
    _hours(admin, [(1, "09:00", "18:00")])
    s = _session(admin, _window("10:00", "14:00"))
    res = client.put(f"/api/sessions/{s['id']}", headers=admin["headers"], json={"available_hours": None})
    assert res.json()["available_hours"] is None
    assert _slots(admin, s["id"])[0] == ("09:00", "10:00")


def test_deleting_a_session_removes_its_windows(admin):
    s = _session(admin, _window("10:00", "14:00"))
    client.delete(f"/api/sessions/{s['id']}", headers=admin["headers"])
    db = SessionLocal()
    try:
        assert db.query(SessionTimeWindow).filter(SessionTimeWindow.session_id == s["id"]).count() == 0
    finally:
        db.close()


# ---------------------------------------------------------------------------------------
# Isolation
# ---------------------------------------------------------------------------------------

def test_admins_windows_do_not_leak(tracked):
    a = _make_admin(tracked, "a")
    b = _make_admin(tracked, "b")
    _hours(a, [(1, "09:00", "18:00")])
    _hours(b, [(1, "09:00", "18:00")])
    sa = _session(a, _window("10:00", "14:00"))
    sb = _session(b, _window("15:00", "18:00"))
    assert all(end <= "14:00" for _, end in _slots(a, sa["id"]))
    assert all(start >= "15:00" for start, _ in _slots(b, sb["id"]))


def test_another_admins_session_cannot_be_timed_against_this_admin(tracked):
    a = _make_admin(tracked, "a")
    b = _make_admin(tracked, "b")
    _hours(a, [(1, "09:00", "18:00")])
    sb = _session(b)
    res = client.get(f"/api/availability/slots?admin_id={a['id']}&session_id={sb['id']}&date_str={MONDAY}")
    assert res.status_code == 404


def test_another_admin_cannot_edit_the_hours(tracked):
    a = _make_admin(tracked, "a")
    b = _make_admin(tracked, "b")
    sa = _session(a, _window("10:00", "14:00"))
    res = client.put(f"/api/sessions/{sa['id']}", headers=b["headers"], json={"available_hours": None})
    assert res.status_code == 404
    assert client.get("/api/sessions/", headers=a["headers"]).json()[0]["available_hours"] == _window("10:00", "14:00")
