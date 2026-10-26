"""
Real Google Meet recording retrieval, tested WITHOUT any network or Google account.

Everything Google returns here is a mock built from the shape in Google's documentation, so these
tests prove our handling (state mapping, permission/temporary errors, transitions, scopes,
auto-record request + fallback, signed private playback, notifications) -- not that Google behaves
this way. Verification against a live Workspace account is still outstanding.
"""
import asyncio
import json
import random
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

import app.api.student_recordings as stream_api
from app.main import app, seed_initial_data
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import (
    AdminProfile, Booking, GoogleConnection, MeetingRecording, MeetingReminder, Notification,
    StudentAllowance, User, UserSecurityState,
)
from app.services import booking_confirm, email_service, recording_google
from app.services import google_calendar as gcal
from app.services.recording_google import (
    PERMISSION_DETAIL, RecordingLookup, RecordingTemporaryError, lookup, make_stream_token,
    recording_scopes_for, verify_stream_token,
)
from app.services.recording_providers import (
    RecordingResult, TransitionError, process_due_recordings, process_recording, recording_worker,
)
from app.services.recording_sim import SIM_SPACE_PREFIX

seed_initial_data()
client = TestClient(app)
REAL_ASYNC_CLIENT = httpx.AsyncClient
PW = "OwnerPassw0rd!1"
PW_HASH = get_password_hash(PW)  # hashed once: bcrypt is the slow part of these tests


# --- fixtures + builders ------------------------------------------------------------------------

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
                db.query(MeetingReminder).filter(MeetingReminder.booking_id.in_(booking_ids)).delete(synchronize_session=False)
            db.query(MeetingRecording).filter(MeetingRecording.student_id == uid).delete(synchronize_session=False)
            db.query(Notification).filter(Notification.admin_id == uid).delete(synchronize_session=False)
            db.query(Booking).filter((Booking.admin_id == uid) | (Booking.student_id == uid)).delete(synchronize_session=False)
            db.query(GoogleConnection).filter(GoogleConnection.admin_id == uid).delete(synchronize_session=False)
            db.query(StudentAllowance).filter(StudentAllowance.student_id == uid).delete(synchronize_session=False)
            db.query(UserSecurityState).filter(UserSecurityState.user_id == uid).delete(synchronize_session=False)
            db.query(AdminProfile).filter(AdminProfile.user_id == uid).delete(synchronize_session=False)
            db.query(User).filter(User.id == uid).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _user(tracked, role, tag):
    uid = uuid.uuid4().hex[:8]
    db = SessionLocal()
    try:
        u = User(name=f"{role} {tag}", email=f"{role}_{tag}_{uid}@testdomain.com",
                 password_hash=PW_HASH, role=role, status="ACTIVE")
        db.add(u)
        db.flush()
        if role in ("super_admin", "admin"):
            db.add(AdminProfile(user_id=u.id, username=f"{role[:2]}{tag}{uid}"))
        db.commit()
        tracked.append(u.id)
        return {"id": u.id, "email": u.email}
    finally:
        db.close()


def _login(email):
    r = client.post("/api/auth/login", json={"username_or_email": email, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _google(host_id):
    db = SessionLocal()
    try:
        db.add(GoogleConnection(admin_id=host_id, google_email=f"host_{uuid.uuid4().hex[:6]}@testdomain.com",
                                encrypted_refresh_token="enc", connection_status="connected"))
        db.commit()
    finally:
        db.close()


def _when(past=True):
    """A unique slot string, in the past (ended) or far future (not ended)."""
    year = 2020 if past else 2099
    return f"{year}-{random.randint(1, 12):02d}-{random.randint(1, 27):02d}T{random.randint(0, 22):02d}:{random.randint(0, 59):02d}:00Z"


def _booking(host_id, student_id, *, past=True, category="student_free", space=None, status="confirmed"):
    start = _when(past)
    db = SessionLocal()
    try:
        b = Booking(public_id=f"BK-{uuid.uuid4().hex[:6]}", admin_id=host_id, student_id=student_id, category=category,
                    client_name="x", client_email="x@y.com", start_time=start, end_time=start[:11] + "23:59:00Z",
                    status=status, payment_status="free", attendance_status="completed",
                    google_meet_space_id=space, cancellation_token=uuid.uuid4().hex)
        db.add(b)
        db.commit()
        return b.id
    finally:
        db.close()


def _recording(host_id, student_id, *, status="available", drive="FILE1", space="spaces/real-abc", past=True):
    booking_id = _booking(host_id, student_id, past=past, space=space)
    db = SessionLocal()
    try:
        row = MeetingRecording(booking_id=booking_id, student_id=student_id, space_name=space,
                               status=status, drive_file_id=drive)
        db.add(row)
        db.commit()
        return booking_id, row.id
    finally:
        db.close()


def _iso(minutes_ago):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- lookup: Google responses -> our states -----------------------------------------------------

def _google_handler(records, recordings, *, records_status=200, recordings_status=200, seen=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if request.url.path.endswith("/conferenceRecords"):
            return httpx.Response(records_status, json={"conferenceRecords": records})
        if request.url.path.endswith("/recordings"):
            return httpx.Response(recordings_status, json={"recordings": recordings})
        return httpx.Response(404)
    return handler


def _lookup(handler, **kwargs):
    async def go():
        async with REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler)) as c:
            return await lookup("tok", "spaces/xyz", client=c, **kwargs)
    return asyncio.run(go())


def _record(started=60, ended=30):
    r = {"name": "conferenceRecords/c1", "startTime": _iso(started)}
    if ended is not None:
        r["endTime"] = _iso(ended)
    return r


def test_lookup_reports_available_only_for_a_generated_file():
    seen = []
    handler = _google_handler([_record()], [{"state": "FILE_GENERATED", "startTime": _iso(59),
                                             "driveDestination": {"file": "files/FILE9"}}], seen=seen)
    found = _lookup(handler, ended_minutes_ago=30)
    assert found.state == "available" and found.drive_file_id == "FILE9" and found.recorded_at is not None
    assert seen[0].headers["Authorization"] == "Bearer tok"
    assert seen[0].url.params["filter"] == 'space.name="spaces/xyz"'


@pytest.mark.parametrize("state", ["STARTED", "ENDED", "FILE_GENERATED"])
def test_lookup_in_progress_states_are_processing_never_available(state):
    recs = [{"state": state, "startTime": _iso(59)}]  # no driveDestination
    assert _lookup(_google_handler([_record()], recs), ended_minutes_ago=30).state == "processing"


@pytest.mark.parametrize("ended_ago,expected", [(None, "pending"), (5, "pending"), (60, "unavailable")])
def test_lookup_with_no_conference_waits_then_gives_up(ended_ago, expected):
    found = _lookup(_google_handler([], []), ended_minutes_ago=ended_ago)
    assert found.state == expected and found.drive_file_id is None
    if expected == "unavailable":
        assert "nothing was recorded" in found.detail


@pytest.mark.parametrize("ended,expected", [(None, "pending"), (5, "pending"), (40, "unavailable")])
def test_lookup_conference_without_a_recording(ended, expected):
    found = _lookup(_google_handler([_record(70, ended)], []), ended_minutes_ago=40)
    assert found.state == expected


@pytest.mark.parametrize("status", [401, 403])
@pytest.mark.parametrize("where", ["records", "recordings"])
def test_lookup_permission_failure_keeps_status_and_explains(status, where):
    handler = _google_handler([_record()], [], records_status=status if where == "records" else 200,
                              recordings_status=status if where == "recordings" else 200)
    found = _lookup(handler, ended_minutes_ago=30)
    assert found.state == "unchanged" and found.detail == PERMISSION_DETAIL


@pytest.mark.parametrize("status", [429, 500, 503])
def test_lookup_temporary_http_errors_raise_for_retry(status):
    with pytest.raises(RecordingTemporaryError):
        _lookup(_google_handler([_record()], [], records_status=status), ended_minutes_ago=30)


@pytest.mark.parametrize("exc", [httpx.ConnectError("down"), httpx.ReadTimeout("slow")])
def test_lookup_network_failures_raise_for_retry(exc):
    def handler(request):
        raise exc

    with pytest.raises(RecordingTemporaryError):
        _lookup(handler, ended_minutes_ago=30)


# --- signed stream tokens -----------------------------------------------------------------------

def test_stream_token_roundtrip_expiry_and_tampering():
    token = make_stream_token("stu-1", "book-1")
    assert verify_stream_token(token, "book-1") == "stu-1"
    assert verify_stream_token(token, "book-2") == ""                       # another booking
    assert verify_stream_token(make_stream_token("stu-1", "book-1", ttl=-5), "book-1") == ""  # expired
    assert verify_stream_token(token[:-1] + ("0" if token[-1] != "0" else "1"), "book-1") == ""  # bad signature
    swapped = token.replace("stu-1", "stu-2", 1)
    assert verify_stream_token(swapped, "book-1") == ""                     # another student
    for junk in ("", "a.b.c", "a.b.notint.sig"):
        assert verify_stream_token(junk, "book-1") == ""


# --- OAuth scopes -------------------------------------------------------------------------------

def test_recording_scopes_only_for_the_super_admin_and_only_when_flagged(monkeypatch):
    monkeypatch.setattr(settings, "RECORDING_SCOPES_ENABLED", False, raising=False)
    assert recording_scopes_for("super_admin") == []
    monkeypatch.setattr(settings, "RECORDING_SCOPES_ENABLED", True, raising=False)
    scopes = recording_scopes_for("super_admin")
    assert "https://www.googleapis.com/auth/meetings.space.settings" in scopes
    assert "https://www.googleapis.com/auth/meetings.space.readonly" in scopes
    assert settings.RECORDING_DRIVE_SCOPE in scopes
    for role in ("admin", "student", "client"):
        assert recording_scopes_for(role) == []


def _scope_of(auth_url):
    return parse_qs(urlparse(auth_url).query)["scope"][0].split(" ")


def test_auth_url_adds_recording_scopes_for_super_admin_only(tracked, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "cid", raising=False)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "secret", raising=False)
    boss = _login(_user(tracked, "super_admin", "sc")["email"])
    admin = _login(_user(tracked, "admin", "sc")["email"])

    monkeypatch.setattr(settings, "RECORDING_SCOPES_ENABLED", False, raising=False)
    off = _scope_of(client.get("/api/google/auth-url", headers=boss).json()["auth_url"])
    assert "https://www.googleapis.com/auth/meetings.space.settings" not in off

    monkeypatch.setattr(settings, "RECORDING_SCOPES_ENABLED", True, raising=False)
    sa = _scope_of(client.get("/api/google/auth-url", headers=boss).json()["auth_url"])
    ad = _scope_of(client.get("/api/google/auth-url", headers=admin).json()["auth_url"])
    assert "https://www.googleapis.com/auth/meetings.space.settings" in sa
    assert "https://www.googleapis.com/auth/calendar.events" in sa          # existing scopes kept
    assert "https://www.googleapis.com/auth/meetings.space.settings" not in ad
    assert ad == off                                                        # a regular admin is unchanged


# --- auto-record request + fallback -------------------------------------------------------------

ON = {"config": {"artifactConfig": {"recordingConfig": {"autoRecordingGeneration": "ON"}}}}


def _space(config=None):
    body = {"name": "spaces/abc", "meetingUri": "https://meet.google.com/abc-defg-hij", "meetingCode": "abc-defg-hij"}
    if config is not None:
        body["config"] = {"artifactConfig": {"recordingConfig": {"autoRecordingGeneration": config}}}
    return body


def _create(monkeypatch, meet_responses, **kwargs):
    bodies = []

    def handler(request):
        if request.url.host == "meet.googleapis.com":
            bodies.append(json.loads(request.content or b"{}"))
            status, payload = meet_responses.pop(0)
            return httpx.Response(status, json=payload)
        if request.url.host == "www.googleapis.com":
            return httpx.Response(200, json={
                "id": "evt1", "htmlLink": "https://cal/x",
                "conferenceData": {"entryPoints": [{"entryPointType": "video", "uri": "https://meet.google.com/abc-defg-hij"}]},
            })
        return httpx.Response(404)

    async def fake_refresh(_):
        return "real-token"

    monkeypatch.setattr(gcal, "refresh_google_token", fake_refresh)
    monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: REAL_ASYNC_CLIENT(*a, transport=httpx.MockTransport(handler), **{k: v for k, v in kw.items() if k != "transport"}))
    result = asyncio.run(gcal.create_calendar_event_with_meet(
        encrypted_refresh_token="enc", title="t", description="d", start_time_iso="2099-01-01T10:00:00Z",
        end_time_iso="2099-01-01T10:20:00Z", client_name="n", client_email="e@x.com", **kwargs))
    return result, bodies


def test_auto_record_is_requested_and_reported_when_google_accepts(monkeypatch):
    result, bodies = _create(monkeypatch, [(200, _space("ON"))], auto_record=True)
    assert bodies == [ON]
    assert result["recording_configured"] is True and result["meet_link"]


def test_auto_record_falls_back_to_a_plain_space_when_google_refuses(monkeypatch):
    result, bodies = _create(monkeypatch, [(400, {"error": {"message": "no"}}), (200, _space())], auto_record=True)
    assert bodies == [ON, {}]                      # retried once, without the recording setting
    assert result["recording_configured"] is False
    assert result["meet_link"] and result["event_id"] == "evt1"   # the booking and link still work


def test_no_auto_record_means_the_old_request_and_no_claim(monkeypatch):
    result, bodies = _create(monkeypatch, [(200, _space())])
    assert bodies == [{}] and result["recording_configured"] is False


def test_google_echoing_the_setting_off_is_believed(monkeypatch):
    result, _ = _create(monkeypatch, [(200, _space("OFF"))], auto_record=True)
    assert result["recording_configured"] is False


# --- booking confirmation wiring ---------------------------------------------------------------

def _confirm(tracked, monkeypatch, *, category, retrieval, configured):
    host = _user(tracked, "super_admin", "bc")
    student = _user(tracked, "student", "bc")
    _google(host["id"])
    booking_id = _booking(host["id"], student["id"] if category != "client" else None, category=category)
    seen = []

    async def fake_create(**kwargs):
        seen.append(kwargs)
        return {"event_id": "e1", "meet_link": "https://meet.google.com/abc-defg-hij",
                "space_name": "spaces/real1", "recording_configured": configured}

    async def noop(**kwargs):
        return True

    monkeypatch.setattr(settings, "RECORDING_RETRIEVAL_ENABLED", retrieval, raising=False)
    monkeypatch.setattr(booking_confirm, "create_calendar_event_with_meet", fake_create)
    monkeypatch.setattr(booking_confirm, "send_booking_confirmation_email", noop)
    monkeypatch.setattr(booking_confirm, "send_admin_new_booking_notification", noop)
    db = SessionLocal()
    try:
        booking = db.query(Booking).filter(Booking.id == booking_id).first()
        admin = db.query(User).filter(User.id == host["id"]).first()
        asyncio.run(booking_confirm.confirm_booking_side_effects(db, booking, admin))
        row = db.query(MeetingRecording).filter(MeetingRecording.booking_id == booking_id).first()
        return seen, (row.status, row.detail) if row else None
    finally:
        db.close()


def test_student_booking_requests_auto_record_and_marks_unsupported_when_refused(tracked, monkeypatch):
    seen, row = _confirm(tracked, monkeypatch, category="student_free", retrieval=True, configured=False)
    assert seen[0]["auto_record"] is True
    assert row == ("unsupported", "Auto-recording could not be enabled for this meeting.")


def test_student_booking_with_recording_configured_waits_for_the_recording(tracked, monkeypatch):
    seen, row = _confirm(tracked, monkeypatch, category="student_paid", retrieval=True, configured=True)
    assert seen[0]["auto_record"] is True and row[0] == "pending"


def test_nothing_changes_for_student_bookings_while_retrieval_is_off(tracked, monkeypatch):
    seen, row = _confirm(tracked, monkeypatch, category="student_free", retrieval=False, configured=False)
    assert "auto_record" not in seen[0] and row is None


def test_regular_client_bookings_are_never_asked_to_record(tracked, monkeypatch):
    seen, row = _confirm(tracked, monkeypatch, category="client", retrieval=True, configured=False)
    assert "auto_record" not in seen[0] and row is None


# --- transitions + notification ----------------------------------------------------------------

class _Provider:
    def __init__(self, result):
        self.result = result

    async def fetch(self, db, row):
        return self.result


def _process(row_id, result):
    db = SessionLocal()
    try:
        row = db.query(MeetingRecording).filter(MeetingRecording.id == row_id).first()
        return asyncio.run(process_recording(db, row, _Provider(result)))
    finally:
        db.close()


def test_real_rows_may_skip_straight_to_available_and_notify_once(tracked, monkeypatch):
    sent = []

    async def fake_send(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_recording_ready_email", fake_send)
    host, student = _user(tracked, "super_admin", "tr"), _user(tracked, "student", "tr")
    _, row_id = _recording(host["id"], student["id"], status="pending", drive=None)
    out = _process(row_id, RecordingResult("available", drive_file_id="F1"))
    assert out["status"] == "available" and out["notification"] == {"sent": True}
    assert _process(row_id, RecordingResult("available", drive_file_id="F1"))["notification"]["reason"] == "already_sent"
    assert len(sent) == 1


def test_real_rows_cannot_go_backwards_from_available_except_to_failed(tracked):
    host, student = _user(tracked, "super_admin", "bk"), _user(tracked, "student", "bk")
    _, row_id = _recording(host["id"], student["id"], status="available")
    with pytest.raises(TransitionError):
        _process(row_id, RecordingResult("processing"))


def test_simulated_rows_keep_the_strict_table(tracked):
    host, student = _user(tracked, "super_admin", "st"), _user(tracked, "student", "st")
    _, row_id = _recording(host["id"], student["id"], status="pending", drive=None, space=SIM_SPACE_PREFIX + "x")
    with pytest.raises(TransitionError):
        _process(row_id, RecordingResult("available"))   # a simulated row must pass through processing


# --- the poll ----------------------------------------------------------------------------------

def _poll():
    db = SessionLocal()
    try:
        return asyncio.run(process_due_recordings(db))
    finally:
        db.close()


def _row(row_id):
    db = SessionLocal()
    try:
        r = db.query(MeetingRecording).filter(MeetingRecording.id == row_id).first()
        return r.status, r.drive_file_id, r.detail
    finally:
        db.close()


def test_the_poll_does_nothing_while_retrieval_is_off(monkeypatch):
    monkeypatch.setattr(settings, "RECORDING_RETRIEVAL_ENABLED", False, raising=False)
    assert _poll() == {"scanned": 0, "reason": "retrieval_disabled"}


def test_the_worker_exits_immediately_when_told_to_stop():
    async def go():
        stop = asyncio.Event()
        stop.set()
        await asyncio.wait_for(recording_worker(stop), timeout=5)

    asyncio.run(go())


def test_the_poll_only_asks_about_ended_meetings(tracked, monkeypatch):
    monkeypatch.setattr(settings, "RECORDING_RETRIEVAL_ENABLED", True, raising=False)
    host, student = _user(tracked, "super_admin", "fu"), _user(tracked, "student", "fu")
    _, row_id = _recording(host["id"], student["id"], status="pending", drive=None, past=False)
    _poll()
    assert _row(row_id) == ("pending", None, None)     # not asked, not touched


def test_the_poll_says_why_when_google_is_not_connected(tracked, monkeypatch):
    monkeypatch.setattr(settings, "RECORDING_RETRIEVAL_ENABLED", True, raising=False)
    host, student = _user(tracked, "super_admin", "nc"), _user(tracked, "student", "nc")
    _, row_id = _recording(host["id"], student["id"], status="pending", drive=None)
    _poll()
    status, _, detail = _row(row_id)
    assert status == "pending" and "not connected" in detail


def _patch_google(monkeypatch, result=None, error=None):
    async def fake_refresh(_):
        return "tok"

    async def fake_lookup(token, space, **kwargs):
        if error:
            raise error
        return result

    monkeypatch.setattr(settings, "RECORDING_RETRIEVAL_ENABLED", True, raising=False)
    monkeypatch.setattr(gcal, "refresh_google_token", fake_refresh)
    monkeypatch.setattr(recording_google, "lookup", fake_lookup)


def test_the_poll_publishes_an_available_recording_and_emails_once(tracked, monkeypatch):
    sent = []

    async def fake_send(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_recording_ready_email", fake_send)
    _patch_google(monkeypatch, RecordingLookup("available", drive_file_id="FILE7"))
    host, student = _user(tracked, "super_admin", "pa"), _user(tracked, "student", "pa")
    _google(host["id"])
    _, row_id = _recording(host["id"], student["id"], status="pending", drive=None)
    _poll()
    assert _row(row_id)[:2] == ("available", "FILE7")
    _poll()                                             # an available row is no longer polled
    assert len(sent) == 1


def test_a_temporary_google_failure_leaves_the_row_for_the_next_poll(tracked, monkeypatch):
    _patch_google(monkeypatch, error=RecordingTemporaryError("Google returned HTTP 503"))
    host, student = _user(tracked, "super_admin", "tf"), _user(tracked, "student", "tf")
    _google(host["id"])
    _, row_id = _recording(host["id"], student["id"], status="processing", drive=None)
    assert _poll()["retry_later"] >= 1
    assert _row(row_id)[0] == "processing"


def test_a_missing_google_permission_is_reported_without_changing_status(tracked, monkeypatch):
    _patch_google(monkeypatch, RecordingLookup("unchanged", detail=PERMISSION_DETAIL))
    host, student = _user(tracked, "super_admin", "pm"), _user(tracked, "student", "pm")
    _google(host["id"])
    _, row_id = _recording(host["id"], student["id"], status="pending", drive=None)
    _poll()
    assert _row(row_id) == ("pending", None, PERMISSION_DETAIL)


# --- cron endpoint -----------------------------------------------------------------------------

def test_the_recordings_cron_endpoint_needs_the_secret(monkeypatch):
    url = "/api/internal/recordings/run"
    monkeypatch.setattr(settings, "RECORDING_RETRIEVAL_ENABLED", False, raising=False)
    monkeypatch.setattr(settings, "CRON_SECRET", "", raising=False)
    assert client.post(url).status_code == 404
    monkeypatch.setattr(settings, "CRON_SECRET", "s3cret", raising=False)
    assert client.post(url).status_code == 403
    assert client.post(url, headers={"X-Cron-Secret": "wrong"}).status_code == 403
    ok = client.post(url, headers={"X-Cron-Secret": "s3cret"})
    assert ok.status_code == 200 and ok.json() == {"scanned": 0, "reason": "retrieval_disabled"}


# --- private playback --------------------------------------------------------------------------

class _FakeUpstream:
    def __init__(self, status=206, body=b"abcd"):
        self.status_code = status
        self.headers = {"content-type": "video/mp4", "content-length": str(len(body)),
                        "content-range": "bytes 0-3/10", "accept-ranges": "bytes", "set-cookie": "leak=1"}
        self._body = body
        self.closed = False

    async def aiter_raw(self):
        yield self._body

    async def aclose(self):
        self.closed = True


class _FakeClient:
    closed = False

    async def aclose(self):
        self.closed = True


def _world(tracked):
    host = _user(tracked, "super_admin", "pw")
    a, b = _user(tracked, "student", "pa"), _user(tracked, "student", "pb")
    _google(host["id"])
    booking_id, row_id = _recording(host["id"], a["id"])
    return {"host": host, "a": a, "b": b, "booking_id": booking_id, "row_id": row_id}


def _patch_drive(monkeypatch, status=206):
    calls, upstream, drive = [], _FakeUpstream(status), _FakeClient()

    async def fake_refresh(_):
        return "tok"

    async def fake_open(token, file_id, range_header=None):
        calls.append((token, file_id, range_header))
        return drive, upstream

    monkeypatch.setattr(stream_api, "refresh_google_token", fake_refresh)
    monkeypatch.setattr(recording_google, "open_drive_media", fake_open)
    return calls, upstream, drive


def test_play_issues_a_signed_link_that_hides_google_details(tracked):
    w = _world(tracked)
    r = client.get(f"/api/student/recordings/{w['booking_id']}/play", headers=_login(w["a"]["email"]))
    body = r.json()
    assert r.status_code == 200 and body["playable"] is True and body["simulated"] is False
    assert body["stream_path"].startswith(f"/student/recordings/{w['booking_id']}/stream?t=")
    blob = json.dumps(body)
    assert "FILE1" not in blob and "tok" not in blob and "drive" not in blob.lower()


def test_play_is_login_protected_and_owner_only(tracked):
    w = _world(tracked)
    path = f"/api/student/recordings/{w['booking_id']}/play"
    assert client.get(path).status_code == 401
    other = client.get(path, headers=_login(w["b"]["email"]))
    missing = client.get(f"/api/student/recordings/{uuid.uuid4()}/play", headers=_login(w["b"]["email"]))
    assert other.status_code == 404 and other.json() == missing.json()


def test_the_stream_proxies_with_range_and_closes_upstream(tracked, monkeypatch):
    w = _world(tracked)
    calls, upstream, drive = _patch_drive(monkeypatch)
    link = client.get(f"/api/student/recordings/{w['booking_id']}/play", headers=_login(w["a"]["email"])).json()["stream_path"]
    r = client.get("/api" + link, headers={"Range": "bytes=0-3"})
    assert r.status_code == 206 and r.content == b"abcd"
    assert r.headers["content-range"] == "bytes 0-3/10" and r.headers["accept-ranges"] == "bytes"
    assert r.headers["cache-control"] == "private, no-store"
    assert "set-cookie" not in r.headers                    # only the whitelisted upstream headers pass
    assert calls == [("tok", "FILE1", "bytes=0-3")]
    assert upstream.closed and drive.closed


def _stream(w, token):
    return client.get(f"/api/student/recordings/{w['booking_id']}/stream", params={"t": token})


def test_the_stream_refuses_bad_tokens_and_other_students(tracked, monkeypatch):
    w = _world(tracked)
    _patch_drive(monkeypatch)
    good = make_stream_token(w["a"]["id"], w["booking_id"])
    assert _stream(w, good).status_code == 206
    assert _stream(w, "").status_code == 404
    assert _stream(w, good[:-1] + ("0" if good[-1] != "0" else "1")).status_code == 404       # tampered
    assert _stream(w, make_stream_token(w["a"]["id"], w["booking_id"], ttl=-5)).status_code == 404  # expired
    assert _stream(w, make_stream_token(w["b"]["id"], w["booking_id"])).status_code == 404    # B's token, A's recording
    other = client.get(f"/api/student/recordings/{uuid.uuid4()}/stream", params={"t": good})
    assert other.status_code == 404                                                           # token for another booking


def test_the_stream_refuses_simulated_unavailable_disabled_and_unconnected(tracked, monkeypatch):
    w = _world(tracked)
    _patch_drive(monkeypatch)
    token = make_stream_token(w["a"]["id"], w["booking_id"])
    db = SessionLocal()
    try:
        def set_row(**vals):
            db.query(MeetingRecording).filter(MeetingRecording.id == w["row_id"]).update(vals)
            db.commit()

        set_row(status="processing")
        assert _stream(w, token).status_code == 404
        set_row(status="available", space_name=SIM_SPACE_PREFIX + "z")
        assert _stream(w, token).status_code == 404
        set_row(space_name="spaces/real-abc", drive_file_id=None)
        assert _stream(w, token).status_code == 404
        set_row(drive_file_id="FILE1")
        db.query(User).filter(User.id == w["a"]["id"]).update({User.status: "TEMPORARILY_DISABLED"})
        db.commit()
        assert _stream(w, token).status_code == 404
        db.query(User).filter(User.id == w["a"]["id"]).update({User.status: "ACTIVE"})
        db.query(GoogleConnection).filter(GoogleConnection.admin_id == w["host"]["id"]).delete()
        db.commit()
        assert _stream(w, token).status_code == 404
    finally:
        db.close()


@pytest.mark.parametrize("upstream_status,expected", [(404, 404), (416, 416), (500, 502), (403, 502)])
def test_the_stream_maps_drive_failures_without_leaking_them(tracked, monkeypatch, upstream_status, expected):
    w = _world(tracked)
    _, upstream, drive = _patch_drive(monkeypatch, status=upstream_status)
    r = _stream(w, make_stream_token(w["a"]["id"], w["booking_id"]))
    assert r.status_code == expected
    assert "google" not in r.text.lower() or expected == 404
    assert upstream.closed and drive.closed


def test_temporary_drive_failure_is_a_retryable_502(tracked, monkeypatch):
    w = _world(tracked)

    async def fake_refresh(_):
        return "tok"

    async def failing_open(token, file_id, range_header=None):
        raise RecordingTemporaryError("Drive request failed: ConnectError")

    monkeypatch.setattr(stream_api, "refresh_google_token", fake_refresh)
    monkeypatch.setattr(recording_google, "open_drive_media", failing_open)
    assert _stream(w, make_stream_token(w["a"]["id"], w["booking_id"])).status_code == 502
