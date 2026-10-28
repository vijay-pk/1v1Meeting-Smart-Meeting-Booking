"""
Student meeting lifecycle, the 24-hour rule, and the recording estimate.

Everything is driven through the real HTTP API or the real sweeps with rows built directly in the
database; nothing talks to Google or Resend. Time-dependent rules are tested against bookings
placed relative to the real clock, and the exact cutoff boundary against a frozen clock.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.main import app, seed_initial_data
from app.models.models import (
    AdminProfile, Booking, MeetingRecording, MeetingTerminationAttempt, Notification,
    Session as SessionModel, SlotLock, User,
)
from app.services import meeting_termination, recording_providers, student_rules
from app.services.meeting_termination import run_due_terminations
from app.services.meeting_recording import list_student_recordings
from app.services.student_rules import CHANGE_WINDOW_HOURS

seed_initial_data()
client = TestClient(app)
BUSINESS_TZ = ZoneInfo(settings.BUSINESS_TIMEZONE)
PW = "StudentPassw0rd!1"


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _wall(dt_utc: datetime) -> str:
    return dt_utc.replace(tzinfo=timezone.utc).astimezone(BUSINESS_TZ).strftime("%Y-%m-%dT%H:%M:00Z")


@pytest.fixture
def world():
    """A Super Admin host and two students, torn down afterwards."""
    ids = []
    db = SessionLocal()

    def mk(role, tag):
        u = User(name=f"{role} {tag}", email=f"{role}_{tag}_{uuid.uuid4().hex[:8]}@testdomain.com",
                 password_hash=get_password_hash(PW), role=role, status="ACTIVE", must_change_password=False)
        db.add(u)
        db.flush()
        if role == "super_admin":
            db.add(AdminProfile(user_id=u.id, username=f"sa{uuid.uuid4().hex[:8]}"))
        ids.append(u.id)
        return u

    host = mk("super_admin", "host")
    stu = mk("student", "one")
    other = mk("student", "two")
    sess = SessionModel(admin_id=host.id, title="q&a", duration_minutes=30, price=0, audience="student_free")
    db.add(sess)
    db.commit()
    w = {"db": db, "host": host, "stu": stu, "other": other, "session": sess, "ids": ids}
    yield w
    db.rollback()
    booking_ids = [b.id for b in db.query(Booking).filter(Booking.admin_id == host.id)]
    if booking_ids:
        db.query(MeetingTerminationAttempt).filter(MeetingTerminationAttempt.booking_id.in_(booking_ids)).delete(synchronize_session=False)
        db.query(MeetingRecording).filter(MeetingRecording.booking_id.in_(booking_ids)).delete(synchronize_session=False)
        db.query(Booking).filter(Booking.id.in_(booking_ids)).delete(synchronize_session=False)
    db.query(SlotLock).filter(SlotLock.admin_id == host.id).delete(synchronize_session=False)
    db.query(Notification).filter(Notification.admin_id == host.id).delete(synchronize_session=False)
    db.query(SessionModel).filter(SessionModel.admin_id == host.id).delete(synchronize_session=False)
    db.query(AdminProfile).filter(AdminProfile.user_id.in_(ids)).delete(synchronize_session=False)
    db.query(User).filter(User.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    db.close()


def _booking(w, start_utc, *, category="student_free", student=None, status="confirmed", minutes=30, meet=True):
    db = w["db"]
    code = f"abc-{uuid.uuid4().hex[:4]}-xyz"
    b = Booking(
        public_id=f"BK-LC-{uuid.uuid4().hex[:8].upper()}", admin_id=w["host"].id, meeting_type_id=w["session"].id,
        client_name="Student", client_email="s@testdomain.com",
        start_time=_wall(start_utc), end_time=_wall(start_utc + timedelta(minutes=minutes)),
        status=status, payment_status="completed",
        google_meet_link=f"https://meet.google.com/{code}" if meet else None,
        google_meet_space_id=f"spaces/{code}" if meet else None,
        cancellation_token=uuid.uuid4().hex, reschedule_token=uuid.uuid4().hex,
        category=category, student_id=(student or w["stu"]).id, attendance_status="pending",
    )
    db.add(b)
    db.flush()
    meeting_termination.schedule_termination_job(b)
    db.commit()
    return b


def _auth(user):
    r = client.post("/api/auth/login", json={"username_or_email": user.email, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _row(w, booking_id):
    w["db"].expire_all()
    return w["db"].query(Booking).filter(Booking.id == booking_id).one()


# ---------------------------------------------------------------------------------------
# 24-hour rule: backend API
# ---------------------------------------------------------------------------------------

def test_cancel_allowed_more_than_24h_before_start(world):
    b = _booking(world, _now() + timedelta(hours=26))
    r = client.post(f"/api/student/bookings/{b.id}/cancel", headers=_auth(world["stu"]))
    assert r.status_code == 200
    row = _row(world, b.id)
    assert row.status == "cancelled" and row.termination_status == "cancelled"


def test_cancel_refused_inside_24h_and_nothing_changes(world):
    b = _booking(world, _now() + timedelta(hours=23))
    r = client.post(f"/api/student/bookings/{b.id}/cancel", headers=_auth(world["stu"]))
    assert r.status_code == 403
    assert "24 hours" in r.json()["detail"]
    assert _row(world, b.id).status == "confirmed"


def test_exact_cutoff_boundary(world, monkeypatch):
    """Friday 4:00 PM start: Thursday 4:00 PM is the last moment; at it, self-service is closed."""
    h = _auth(world["stu"])
    base = (_now() + timedelta(days=4)).replace(second=0, microsecond=0)

    def freeze(when):
        monkeypatch.setattr(student_rules, "_utc_now", lambda: when)
        monkeypatch.setattr(meeting_termination, "_utc_now", lambda: when)

    before = _booking(world, base)
    deadline = student_rules.change_deadline_utc(before.start_time)
    assert deadline == base - timedelta(hours=24)
    freeze(deadline - timedelta(seconds=1))                  # one second before the cutoff
    assert student_rules.change_info(before)["can_change"] is True
    assert client.post(f"/api/student/bookings/{before.id}/cancel", headers=h).status_code == 200

    at = _booking(world, base + timedelta(hours=2))
    freeze(student_rules.change_deadline_utc(at.start_time))   # exactly at the cutoff
    assert student_rules.change_info(at)["can_change"] is False
    r = client.post(f"/api/student/bookings/{at.id}/cancel", headers=h)
    assert r.status_code == 403 and _row(world, at.id).status == "confirmed"
    body = {"start_time": _wall(base + timedelta(days=3)), "end_time": _wall(base + timedelta(days=3, minutes=30))}
    assert client.post(f"/api/bookings/reschedule/{at.reschedule_token}", json=body).status_code == 403


def test_started_or_completed_meeting_cannot_be_cancelled(world):
    done = _booking(world, _now() - timedelta(hours=2))
    r = client.post(f"/api/student/bookings/{done.id}/cancel", headers=_auth(world["stu"]))
    assert r.status_code == 403
    assert _row(world, done.id).status == "confirmed"


def test_another_student_cannot_cancel_it(world):
    b = _booking(world, _now() + timedelta(hours=30))
    r = client.post(f"/api/student/bookings/{b.id}/cancel", headers=_auth(world["other"]))
    assert r.status_code == 404
    assert _row(world, b.id).status == "confirmed"


# ---------------------------------------------------------------------------------------
# 24-hour rule: public token links (the old cancel page wrote to the database directly)
# ---------------------------------------------------------------------------------------

def test_token_cancel_enforces_the_window_for_students(world):
    locked = _booking(world, _now() + timedelta(hours=10))
    assert client.get(f"/api/bookings/cancel/{locked.cancellation_token}").status_code == 403
    r = client.post(f"/api/bookings/cancel/{locked.cancellation_token}")
    assert r.status_code == 403
    assert _row(world, locked.id).status == "confirmed"


def test_token_cancel_works_outside_window_and_frees_the_slot(world):
    b = _booking(world, _now() + timedelta(hours=40))
    world["db"].add(SlotLock(admin_id=world["host"].id, session_id=world["session"].id, start_time=b.start_time,
                             end_time=b.end_time, locked_by_session="x", expires_at=_now() + timedelta(minutes=5), status="active"))
    world["db"].commit()
    assert client.get(f"/api/bookings/cancel/{b.cancellation_token}").status_code == 200
    assert client.post(f"/api/bookings/cancel/{b.cancellation_token}").status_code == 200
    row = _row(world, b.id)
    assert row.status == "cancelled" and row.termination_status == "cancelled"
    lock = world["db"].query(SlotLock).filter(SlotLock.admin_id == world["host"].id).one()
    assert lock.status == "released"


def test_token_cancel_refuses_a_session_that_already_happened(world):
    client_booking = _booking(world, _now() - timedelta(hours=3), category="client")
    r = client.post(f"/api/bookings/cancel/{client_booking.cancellation_token}")
    assert r.status_code == 409
    assert _row(world, client_booking.id).status == "confirmed"


def test_client_booking_ahead_can_still_be_cancelled_by_link(world):
    b = _booking(world, _now() + timedelta(hours=2), category="client")   # no 24h rule for clients
    assert client.post(f"/api/bookings/cancel/{b.cancellation_token}").status_code == 200


def test_token_reschedule_enforces_window_and_completion(world):
    locked = _booking(world, _now() + timedelta(hours=10))
    assert client.get(f"/api/bookings/reschedule/{locked.reschedule_token}").status_code == 403
    body = {"start_time": _wall(_now() + timedelta(days=5)), "end_time": _wall(_now() + timedelta(days=5, minutes=30))}
    assert client.post(f"/api/bookings/reschedule/{locked.reschedule_token}", json=body).status_code == 403
    done = _booking(world, _now() - timedelta(hours=3), category="client")
    assert client.get(f"/api/bookings/reschedule/{done.reschedule_token}").status_code == 409


def test_public_booking_hides_action_links_when_locked_or_done(world):
    locked = _booking(world, _now() + timedelta(hours=5))
    pub = client.get(f"/api/bookings/public/{locked.public_id}").json()
    assert pub["cancellation_token"] is None and pub["reschedule_token"] is None
    open_ = _booking(world, _now() + timedelta(hours=60))
    pub = client.get(f"/api/bookings/public/{open_.public_id}").json()
    assert pub["cancellation_token"] and pub["reschedule_token"]


# ---------------------------------------------------------------------------------------
# Completed lifecycle
# ---------------------------------------------------------------------------------------

def test_my_meetings_reports_upcoming_then_completed_from_the_server(world):
    upcoming = _booking(world, _now() + timedelta(hours=60))
    past = _booking(world, _now() - timedelta(hours=2))
    rows = {r["id"]: r for r in client.get("/api/student/bookings", headers=_auth(world["stu"])).json()}
    assert rows[upcoming.id]["lifecycle_status"] == "upcoming" and rows[upcoming.id]["can_change"] is True
    assert rows[past.id]["lifecycle_status"] == "completed" and rows[past.id]["can_change"] is False
    # change_deadline_at is start - 24h in UTC with an explicit Z (business time is not mistaken for UTC).
    start = datetime.fromisoformat(rows[upcoming.id]["scheduled_start_at"].replace("Z", "+00:00"))
    deadline = datetime.fromisoformat(rows[upcoming.id]["change_deadline_at"].replace("Z", "+00:00"))
    assert start - deadline == timedelta(hours=24)


def test_completion_is_persisted_at_scheduled_end_without_touching_the_termination_job(world):
    start = _now() - timedelta(minutes=31)          # ended one minute ago, still inside the grace period
    b = _booking(world, start)
    assert b.completed_at is None
    asyncio.run(run_due_terminations(world["db"]))
    row = _row(world, b.id)
    end = meeting_termination.booking_end_utc(row.end_time)
    assert row.completed_at == end                  # persisted by the sweep
    assert row.status == "confirmed"                # lifecycle marker only
    assert row.termination_status == "pending"      # the job still waits for end + 3 minutes
    assert row.attendance_status == "pending"       # no attendance is claimed at scheduled end
    # Idempotent.
    asyncio.run(run_due_terminations(world["db"]))
    assert _row(world, b.id).completed_at == end


def test_termination_still_runs_at_end_plus_grace_after_completion(world, monkeypatch):
    import httpx

    class Meet:
        def __init__(self):
            self.calls = []

        def handler(self, request):
            self.calls.append(request.method)
            if request.method == "GET":
                return httpx.Response(200, json={"name": request.url.path[4:], "activeConference": {"conferenceRecord": "c"}})
            return httpx.Response(200, json={})

    start = _now() + timedelta(hours=1)
    b = _booking(world, start)
    code = b.google_meet_space_id.split("/")[1]

    async def fake_refresh(_):
        return "tok"
    from app.models.models import GoogleConnection
    from app.core.security import encrypt_secret
    world["db"].add(GoogleConnection(admin_id=world["host"].id, google_email="g@x.com",
                                     encrypted_refresh_token=encrypt_secret("r"), connection_status="connected"))
    world["db"].commit()
    monkeypatch.setattr(meeting_termination, "refresh_google_token", fake_refresh)
    meet = Meet()
    monkeypatch.setattr(meeting_termination, "_http_transport", httpx.MockTransport(meet.handler))
    end = start + timedelta(minutes=30)
    asyncio.run(run_due_terminations(world["db"], now=end + timedelta(minutes=1)))
    assert _row(world, b.id).completed_at is not None and meet.calls == []     # completed, but Meet untouched
    asyncio.run(run_due_terminations(world["db"], now=end + timedelta(minutes=3)))
    assert meet.calls == ["GET", "POST"]
    assert _row(world, b.id).termination_status == "completed"
    assert code in b.google_meet_space_id
    world["db"].query(GoogleConnection).filter(GoogleConnection.admin_id == world["host"].id).delete()
    world["db"].commit()


def test_termination_failure_is_kept_but_not_shown_to_students(world):
    b = _booking(world, _now() - timedelta(hours=2))
    b.termination_status = "failed"
    b.termination_error = "Google refused access to this meeting space (403). internal detail"
    world["db"].commit()
    row = client.get("/api/student/bookings", headers=_auth(world["stu"])).json()[0]
    assert row["lifecycle_status"] == "completed"             # history intact
    assert row["meeting_phase"] == "termination_failed"       # honest, not "ended"
    assert "internal detail" not in str(row) and "termination_detail" not in row
    assert "internal detail" in (_row(world, b.id).termination_error or "")   # kept for troubleshooting
    pub = client.get(f"/api/bookings/public/{b.public_id}").json()
    assert "internal detail" not in str(pub)


# ---------------------------------------------------------------------------------------
# Recording estimate
# ---------------------------------------------------------------------------------------

def _recording(w, booking, status="processing"):
    row = MeetingRecording(booking_id=booking.id, student_id=booking.student_id, space_name=booking.google_meet_space_id,
                           status=status)
    w["db"].add(row)
    w["db"].commit()
    return row


def test_estimate_is_stored_from_scheduled_end_and_never_restarted(world):
    b = _booking(world, _now() - timedelta(minutes=40), minutes=30)     # ended 10 minutes ago
    _recording(world, b)
    h = _auth(world["stu"])
    first = client.get("/api/student/recordings", headers=h).json()["recordings"][0]
    end = meeting_termination.booking_end_utc(b.end_time)
    expected = end + timedelta(minutes=settings.RECORDING_ETA_MINUTES)
    assert first["estimated_ready_at"] == expected.isoformat(timespec="seconds") + "Z"
    assert first["eta_is_estimate"] is True and first["still_processing"] is False
    # Reloads (and a 'refresh') return the same stored instant: it is not measured from page opens.
    for _ in range(3):
        again = client.get("/api/student/recordings", headers=h).json()["recordings"][0]
        assert again["estimated_ready_at"] == first["estimated_ready_at"]
    world["db"].expire_all()
    assert world["db"].query(MeetingRecording).filter(MeetingRecording.booking_id == b.id).one().estimated_ready_at == expected


def test_past_the_estimate_it_is_still_processing_not_available_or_failed(world):
    b = _booking(world, _now() - timedelta(hours=3))                      # ended long ago
    _recording(world, b, status="processing")
    r = client.get("/api/student/recordings", headers=_auth(world["stu"])).json()["recordings"][0]
    assert r["still_processing"] is True
    assert r["status"] == "processing" and r["playable"] is False


def test_available_recording_has_no_countdown_and_is_playable(world):
    b = _booking(world, _now() - timedelta(hours=3))
    row = _recording(world, b, status="available")
    row.drive_file_id = "drive-1"
    world["db"].commit()
    r = client.get("/api/student/recordings", headers=_auth(world["stu"])).json()["recordings"][0]
    assert r["status"] == "available" and r["playable"] is True
    assert r["estimated_ready_at"] is None and r["still_processing"] is False


def test_reschedule_restarts_the_estimate_from_the_new_end(world):
    b = _booking(world, _now() + timedelta(days=4))
    row = _recording(world, b, status="pending")
    row.estimated_ready_at = _now() + timedelta(days=4)
    world["db"].commit()
    start = _now() + timedelta(days=6)
    body = {"start_time": _wall(start), "end_time": _wall(start + timedelta(minutes=30))}
    r = client.post(f"/api/bookings/reschedule/{b.reschedule_token}", json=body)
    assert r.status_code == 200, r.text
    world["db"].expire_all()
    assert world["db"].query(MeetingRecording).filter(MeetingRecording.booking_id == b.id).one().estimated_ready_at is None
    assert _row(world, b.id).start_time == body["start_time"]


def test_students_only_see_and_play_their_own_recordings(world):
    b = _booking(world, _now() - timedelta(hours=3))
    row = _recording(world, b, status="available")
    row.drive_file_id = "drive-1"
    world["db"].commit()
    other = _auth(world["other"])
    assert client.get("/api/student/recordings", headers=other).json()["recordings"] == []
    assert client.get(f"/api/student/recordings/{b.id}/play", headers=other).status_code == 404
    assert client.get(f"/api/student/recordings/{b.id}/play", headers=_auth(world["stu"])).status_code == 200


def test_ready_email_is_sent_once_and_retried_if_it_failed(world, monkeypatch):
    b = _booking(world, _now() - timedelta(hours=3))
    row = _recording(world, b, status="available")
    row.drive_file_id = "drive-1"
    world["db"].commit()
    monkeypatch.setattr(settings, "RECORDING_RETRIEVAL_ENABLED", True)
    sent, outcomes = [], [False, True, True]

    async def fake_send(**kw):
        sent.append(kw["to_email"])
        return outcomes.pop(0)

    from app.services import email_service
    monkeypatch.setattr(email_service, "send_recording_ready_email", fake_send)
    run = lambda: asyncio.run(recording_providers.process_due_recordings(world["db"]))
    run()                                    # first attempt fails -> claim released
    world["db"].expire_all()
    assert world["db"].query(MeetingRecording).filter(MeetingRecording.booking_id == b.id).one().email_sent_at is None
    run()                                    # retried by the worker, succeeds
    run()                                    # nothing more to send
    run()
    assert len(sent) == 2                    # one failure + exactly one success, never a duplicate
    world["db"].expire_all()
    assert world["db"].query(MeetingRecording).filter(MeetingRecording.booking_id == b.id).one().email_sent_at is not None


def test_a_simulated_or_unavailable_recording_is_never_emailed(world, monkeypatch):
    b = _booking(world, _now() - timedelta(hours=3))
    _recording(world, b, status="unavailable")
    monkeypatch.setattr(settings, "RECORDING_RETRIEVAL_ENABLED", True)
    sent = []

    async def fake_send(**kw):
        sent.append(kw)
        return True

    from app.services import email_service
    monkeypatch.setattr(email_service, "send_recording_ready_email", fake_send)
    asyncio.run(recording_providers.process_due_recordings(world["db"]))
    assert sent == []


def test_estimate_survives_a_restart(world):
    """The ETA is a column, so a new process (new session) reads the same value."""
    b = _booking(world, _now() - timedelta(minutes=40))
    _recording(world, b)
    list_student_recordings(world["db"], world["stu"].id, confirmed_only=True)
    fresh = SessionLocal()
    try:
        a = fresh.query(MeetingRecording).filter(MeetingRecording.booking_id == b.id).one().estimated_ready_at
        again = list_student_recordings(fresh, world["stu"].id, confirmed_only=True)[0]
        assert again["estimated_ready_at"] == a.isoformat(timespec="seconds") + "Z"
    finally:
        fresh.close()
