"""
Student recording workflow: the dev-only simulation, its production guard, student-specific
access control, and the recording-ready notification rules. Nothing here calls Google.
Each test builds and tears down its own rows.
"""
import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app, seed_initial_data
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import (
    AdminProfile, Booking, MeetingRecording, StudentAllowance, AllowanceAdjustment,
    StudentCredentialEmail, StudentPolicyAcceptance, User, UserSecurityState,
)
from app.services import email_service
from app.services.recording_providers import notify_if_ready
from app.services.student_accounts import TEMP_PASSWORD

seed_initial_data()
client = TestClient(app)
PW = "OwnerPassw0rd!1"
SEED = "/api/super-admin/dev/recording-sim/seed"


@pytest.fixture
def tracked():
    ids = []
    yield ids
    db = SessionLocal()
    try:
        for uid in ids:
            booking_ids = [b.id for b in db.query(Booking).filter((Booking.admin_id == uid) | (Booking.student_id == uid)).all()]
            if booking_ids:
                db.query(MeetingRecording).filter(MeetingRecording.booking_id.in_(booking_ids)).delete(synchronize_session=False)
            db.query(MeetingRecording).filter(MeetingRecording.student_id == uid).delete(synchronize_session=False)
            db.query(Booking).filter((Booking.admin_id == uid) | (Booking.student_id == uid)).delete(synchronize_session=False)
            for model, col in (
                (StudentAllowance, StudentAllowance.student_id), (AllowanceAdjustment, AllowanceAdjustment.student_id),
                (StudentCredentialEmail, StudentCredentialEmail.student_id),
                (StudentPolicyAcceptance, StudentPolicyAcceptance.student_id),
                (UserSecurityState, UserSecurityState.user_id), (AdminProfile, AdminProfile.user_id),
            ):
                db.query(model).filter(col == uid).delete(synchronize_session=False)
            db.query(User).filter(User.id == uid).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


@pytest.fixture
def sim_on(monkeypatch):
    """Simulation allowed: flag on, local APP_URL, real retrieval off."""
    monkeypatch.setattr(settings, "RECORDING_SIMULATION_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "APP_URL", "http://localhost:5173", raising=False)
    monkeypatch.setattr(settings, "RECORDING_RETRIEVAL_ENABLED", False, raising=False)


def _user(tracked, role, tag, email_domain="testdomain.com"):
    uid = uuid.uuid4().hex[:8]
    db = SessionLocal()
    try:
        u = User(name=f"{role} {tag}", email=f"{role}_{tag}_{uid}@{email_domain}",
                 password_hash=get_password_hash(PW), role=role, status="ACTIVE")
        db.add(u)
        db.flush()
        if role in ("super_admin", "admin"):
            db.add(AdminProfile(user_id=u.id, username=f"{role[:2]}{tag}{uid}"))
        db.commit()
        tracked.append(u.id)
        return {"id": u.id, "email": u.email}
    finally:
        db.close()


def _login(email, password=PW):
    r = client.post("/api/auth/login", json={"username_or_email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _seed(tracked, boss_headers):
    r = client.post(SEED, headers=boss_headers, json={})
    assert r.status_code == 200, r.text
    body = r.json()
    tracked.append(body["student_id"])
    return body


def _student_headers(seeded):
    """The seeded TEST student signs in with the temporary password (first-login gate cleared)."""
    db = SessionLocal()
    try:
        db.query(User).filter(User.id == seeded["student_id"]).update({User.must_change_password: False})
        db.commit()
    finally:
        db.close()
    return _login(seeded["student_email"], TEMP_PASSWORD)


def _advance(boss, booking_id, status):
    return client.post(f"/api/super-admin/dev/recording-sim/{booking_id}/advance", headers=boss, json={"status": status})


def _real_recording(host_id, student_id, status="available"):
    """A non-simulated booking + recording row (as real retrieval would produce)."""
    db = SessionLocal()
    try:
        b = Booking(public_id=f"BK-{uuid.uuid4().hex[:6]}", admin_id=host_id, student_id=student_id,
                    category="student_free", client_name="x", client_email="x@y.com",
                    start_time=f"2020-01-{uuid.uuid4().int % 27 + 1:02d}T10:{uuid.uuid4().int % 59:02d}:00Z",
                    end_time="2020-01-01T10:30:00Z", status="confirmed", payment_status="free",
                    attendance_status="completed", google_meet_space_id="spaces/abc-defg-hij",
                    cancellation_token=uuid.uuid4().hex)
        db.add(b)
        db.flush()
        row = MeetingRecording(booking_id=b.id, student_id=student_id, space_name="spaces/abc-defg-hij", status=status)
        db.add(row)
        db.commit()
        return b.id, row.id
    finally:
        db.close()


# --- production guard ----------------------------------------------------------------------

def test_simulation_is_404_when_flag_off(tracked, monkeypatch):
    monkeypatch.setattr(settings, "RECORDING_SIMULATION_ENABLED", False, raising=False)
    boss = _login(_user(tracked, "super_admin", "off")["email"])
    assert client.post(SEED, headers=boss, json={}).status_code == 404
    assert _advance(boss, "nope", "processing").status_code == 404
    assert client.delete("/api/super-admin/dev/recording-sim/nope", headers=boss).status_code == 404


def test_simulation_is_404_on_a_non_local_app_url(tracked, monkeypatch, sim_on):
    monkeypatch.setattr(settings, "APP_URL", "https://meet.adwaysacademy.com", raising=False)
    boss = _login(_user(tracked, "super_admin", "prod")["email"])
    assert client.post(SEED, headers=boss, json={}).status_code == 404


def test_simulation_is_404_when_real_retrieval_is_on(tracked, monkeypatch, sim_on):
    monkeypatch.setattr(settings, "RECORDING_RETRIEVAL_ENABLED", True, raising=False)
    boss = _login(_user(tracked, "super_admin", "real")["email"])
    assert client.post(SEED, headers=boss, json={}).status_code == 404


def test_only_the_super_admin_can_use_the_simulation(tracked, sim_on):
    admin = _login(_user(tracked, "admin", "a")["email"])
    student = _login(_user(tracked, "student", "s")["email"])
    for headers in (admin, student):
        assert client.post(SEED, headers=headers, json={}).status_code == 403
    assert client.post(SEED, json={}).status_code == 401


def test_seeding_refuses_a_real_student(tracked, sim_on):
    boss = _login(_user(tracked, "super_admin", "b")["email"])
    real = _user(tracked, "student", "real")  # @testdomain.com, not a reserved .test address
    r = client.post(SEED, headers=boss, json={"student_id": real["id"]})
    assert r.status_code == 400


def test_advancing_a_real_recording_is_refused(tracked, sim_on):
    boss_u = _user(tracked, "super_admin", "r")
    boss = _login(boss_u["email"])
    student = _user(tracked, "student", "r")
    booking_id, _ = _real_recording(boss_u["id"], student["id"], status="pending")
    assert _advance(boss, booking_id, "processing").status_code == 400


# --- state cycle + student view ------------------------------------------------------------

def test_full_cycle_and_test_labelling(tracked, sim_on):
    boss = _login(_user(tracked, "super_admin", "cyc")["email"])
    seeded = _seed(tracked, boss)
    assert seeded["student_email"].endswith("@bookmymeet.test")
    student = _student_headers(seeded)

    def mine():
        r = client.get("/api/student/recordings", headers=student)
        assert r.status_code == 200, r.text
        return r.json()["recordings"]

    items = mine()
    assert len(items) == 1 and items[0]["status"] == "pending"
    assert items[0]["simulated"] is True and items[0]["test_label"]
    assert items[0]["title"].startswith("[TEST]")

    assert _advance(boss, seeded["booking_id"], "available").status_code == 400  # must pass through processing
    for status in ("processing", "available", "unavailable"):
        assert _advance(boss, seeded["booking_id"], status).status_code == 200
        assert mine()[0]["status"] == status
    assert _advance(boss, seeded["booking_id"], "processing").status_code == 400  # unavailable -> pending only


def test_seeded_booking_is_ignored_by_the_workers(tracked, sim_on):
    boss = _login(_user(tracked, "super_admin", "wk")["email"])
    seeded = _seed(tracked, boss)
    db = SessionLocal()
    try:
        b = db.query(Booking).filter(Booking.id == seeded["booking_id"]).first()
        assert b.termination_status == "not_applicable"
        assert b.public_id.startswith("SIM-")
        assert b.attendance_status == "pending"  # never consumes the allowance
    finally:
        db.close()


def test_simulated_entries_are_hidden_when_simulation_is_off(tracked, sim_on, monkeypatch):
    boss = _login(_user(tracked, "super_admin", "hid")["email"])
    seeded = _seed(tracked, boss)
    student = _student_headers(seeded)
    assert len(client.get("/api/student/recordings", headers=student).json()["recordings"]) == 1
    monkeypatch.setattr(settings, "RECORDING_SIMULATION_ENABLED", False, raising=False)
    assert client.get("/api/student/recordings", headers=student).json()["recordings"] == []


# --- access control ------------------------------------------------------------------------

def test_a_student_cannot_see_another_students_recordings(tracked, sim_on):
    boss = _login(_user(tracked, "super_admin", "acl")["email"])
    a, b = _seed(tracked, boss), _seed(tracked, boss)
    ha, hb = _student_headers(a), _student_headers(b)
    for s in ("processing", "available"):
        _advance(boss, a["booking_id"], s)

    a_ids = [r["booking_id"] for r in client.get("/api/student/recordings", headers=ha).json()["recordings"]]
    b_ids = [r["booking_id"] for r in client.get("/api/student/recordings", headers=hb).json()["recordings"]]
    assert a_ids == [a["booking_id"]] and b_ids == [b["booking_id"]]

    # B asking for A's recording gets the same 404 as a recording that does not exist.
    other = client.get(f"/api/student/recordings/{a['booking_id']}/play", headers=hb)
    missing = client.get(f"/api/student/recordings/{uuid.uuid4()}/play", headers=hb)
    assert other.status_code == 404 and missing.status_code == 404
    assert other.json() == missing.json()


def test_simulated_available_play_returns_no_video_and_no_url(tracked, sim_on):
    boss = _login(_user(tracked, "super_admin", "play")["email"])
    seeded = _seed(tracked, boss)
    student = _student_headers(seeded)
    for s in ("processing", "available"):
        _advance(boss, seeded["booking_id"], s)
    r = client.get(f"/api/student/recordings/{seeded['booking_id']}/play", headers=student)
    assert r.status_code == 200
    body = r.json()
    assert body["simulated"] is True and body["playable"] is False
    assert not any(k in body for k in ("url", "link", "drive_file_id"))
    listed = client.get("/api/student/recordings", headers=student).json()["recordings"][0]
    assert listed["playable"] is False  # a TEST entry is never playable


# --- notification rules --------------------------------------------------------------------

def test_simulated_recordings_never_reach_the_email_sender(tracked, sim_on, monkeypatch):
    async def must_not_send(**kwargs):
        raise AssertionError("a simulated recording must never be emailed")

    monkeypatch.setattr(email_service, "send_recording_ready_email", must_not_send)
    boss = _login(_user(tracked, "super_admin", "mail")["email"])
    seeded = _seed(tracked, boss)
    _advance(boss, seeded["booking_id"], "processing")
    r = _advance(boss, seeded["booking_id"], "available")
    assert r.status_code == 200
    assert r.json()["notification"]["suppressed"] is True
    db = SessionLocal()
    try:
        row = db.query(MeetingRecording).filter(MeetingRecording.booking_id == seeded["booking_id"]).first()
        assert row.email_sent_at is None
    finally:
        db.close()


def test_a_real_available_recording_sends_exactly_once(tracked, monkeypatch):
    calls = []

    async def fake_send(**kwargs):
        calls.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_recording_ready_email", fake_send)
    host, student = _user(tracked, "super_admin", "once"), _user(tracked, "student", "once")
    _, row_id = _real_recording(host["id"], student["id"])
    db = SessionLocal()
    try:
        row = db.query(MeetingRecording).filter(MeetingRecording.id == row_id).first()
        first = asyncio.run(notify_if_ready(db, row))
        second = asyncio.run(notify_if_ready(db, row))
    finally:
        db.close()
    assert first == {"sent": True} and second["reason"] == "already_sent"
    assert len(calls) == 1
    assert calls[0]["to_email"] == student["email"]
    assert calls[0]["dashboard_url"].endswith("/student/recordings")  # a dashboard link, never a Drive URL


def test_a_real_recording_for_a_test_address_is_never_sent(tracked, monkeypatch):
    calls = []

    async def fake_send(**kwargs):
        calls.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_recording_ready_email", fake_send)
    host = _user(tracked, "super_admin", "tst")
    student = _user(tracked, "student", "tst", email_domain="bookmymeet.test")
    _, row_id = _real_recording(host["id"], student["id"])
    db = SessionLocal()
    try:
        row = db.query(MeetingRecording).filter(MeetingRecording.id == row_id).first()
        result = asyncio.run(notify_if_ready(db, row))
    finally:
        db.close()
    assert result["suppressed"] is True and calls == []


def test_a_failed_send_releases_the_claim_so_it_can_retry(tracked, monkeypatch):
    async def failing_send(**kwargs):
        return False

    monkeypatch.setattr(email_service, "send_recording_ready_email", failing_send)
    host, student = _user(tracked, "super_admin", "fail"), _user(tracked, "student", "fail")
    _, row_id = _real_recording(host["id"], student["id"])
    db = SessionLocal()
    try:
        row = db.query(MeetingRecording).filter(MeetingRecording.id == row_id).first()
        assert asyncio.run(notify_if_ready(db, row))["reason"] == "send_failed"
        db.refresh(row)
        assert row.email_sent_at is None
    finally:
        db.close()


def test_no_email_unless_the_recording_is_available(tracked, monkeypatch):
    calls = []

    async def fake_send(**kwargs):
        calls.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_recording_ready_email", fake_send)
    host, student = _user(tracked, "super_admin", "na"), _user(tracked, "student", "na")
    _, row_id = _real_recording(host["id"], student["id"], status="processing")
    db = SessionLocal()
    try:
        row = db.query(MeetingRecording).filter(MeetingRecording.id == row_id).first()
        assert asyncio.run(notify_if_ready(db, row))["reason"] == "not_available"
    finally:
        db.close()
    assert calls == []
