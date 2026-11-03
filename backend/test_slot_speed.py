"""
Slot availability speed: the Google token / FreeBusy caches and the host-configuration cache.

The rules these tests hold the optimisation to:
  * same answers as the uncached engine;
  * bookings and holds are always read live (two visitors can never be offered one slot);
  * every edit shows up immediately (the cache is invalidated on write);
  * a Google failure is never cached and never becomes "free" (fail closed);
  * far fewer database statements and Google calls per click.
Google is replaced by an httpx.MockTransport; nothing here touches the network.
"""
import uuid
from datetime import datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.core.security import encrypt_secret
from app.main import app, seed_initial_data
from app.models.models import (
    AvailabilityException, AvailabilityRule, Booking, GoogleConnection, Session as SessionModel,
)
from app.services import availability_cache, google_calendar
from app.services.google_calendar import GoogleCalendarUnavailable, get_google_busy_intervals

from test_persistence import _make_admin, admin, db, tracked  # noqa: F401

seed_initial_data()
client = TestClient(app)
REAL_ASYNC_CLIENT = httpx.AsyncClient


class FakeGoogle:
    """oauth2 token + freeBusy, with counters and switchable failures."""

    def __init__(self):
        self.token_calls = 0
        self.busy_calls = 0
        self.busy = []                 # list of {"start","end"} real-UTC strings
        self.busy_status = 200
        self.token_status = 200
        self.reject_token_once = False  # first freeBusy answers 401, then recovers

    def handler(self, request: httpx.Request) -> httpx.Response:
        if "oauth2.googleapis.com" in request.url.host:
            self.token_calls += 1
            if self.token_status != 200:
                return httpx.Response(self.token_status, json={"error": "invalid_grant", "error_description": "revoked"})
            return httpx.Response(200, json={"access_token": f"tok{self.token_calls}", "expires_in": 3599})
        self.busy_calls += 1
        if self.reject_token_once:
            self.reject_token_once = False
            return httpx.Response(401, json={"error": {"message": "invalid credentials"}})
        if self.busy_status != 200:
            return httpx.Response(self.busy_status, json={"error": {"message": "boom"}})
        return httpx.Response(200, json={"calendars": {"primary": {"busy": self.busy}}})


@pytest.fixture
def google(monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "client-id", raising=False)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "client-secret", raising=False)
    monkeypatch.setattr(
        google_calendar.httpx, "AsyncClient",
        lambda *a, **k: REAL_ASYNC_CLIENT(*a, transport=httpx.MockTransport(fake.handler), **{x: y for x, y in k.items() if x != "transport"}),
    )
    return fake


@pytest.fixture
def caches_on(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_TOKEN_CACHE_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "GOOGLE_FREEBUSY_CACHE_SECONDS", 45, raising=False)
    monkeypatch.setattr(settings, "AVAILABILITY_CONFIG_CACHE_SECONDS", 20, raising=False)
    availability_cache.clear()
    google_calendar.clear_google_caches()


ENC = encrypt_secret("refresh-token-abc")
WIN = ("2030-06-03T00:00:00Z", "2030-06-04T00:00:00Z")


def _run(coro):
    import asyncio
    return asyncio.run(coro)


# ---------------------------------------------------------------------------------------
# Google token + FreeBusy caches
# ---------------------------------------------------------------------------------------

def test_the_token_is_refreshed_once_not_on_every_call(google, caches_on, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_FREEBUSY_CACHE_SECONDS", 0)          # isolate the token cache
    _run(get_google_busy_intervals(ENC, *WIN))
    _run(get_google_busy_intervals(ENC, "2030-06-04T00:00:00Z", "2030-06-05T00:00:00Z"))
    assert google.token_calls == 1 and google.busy_calls == 2


def test_without_the_cache_every_call_refreshes(google, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_TOKEN_CACHE_ENABLED", False)
    _run(get_google_busy_intervals(ENC, *WIN))
    _run(get_google_busy_intervals(ENC, *WIN))
    assert google.token_calls == 2 and google.busy_calls == 2


def test_an_identical_freebusy_window_is_answered_from_memory(google, caches_on):
    google.busy = [{"start": "2030-06-03T04:00:00Z", "end": "2030-06-03T05:00:00Z"}]
    first = _run(get_google_busy_intervals(ENC, *WIN))
    second = _run(get_google_busy_intervals(ENC, *WIN))
    assert first == second == google.busy
    assert google.busy_calls == 1
    _run(get_google_busy_intervals(ENC, "2030-06-04T00:00:00Z", "2030-06-05T00:00:00Z"))   # a different window
    assert google.busy_calls == 2


def test_a_cached_answer_expires(google, caches_on, monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(google_calendar.time, "monotonic", lambda: now[0])
    _run(get_google_busy_intervals(ENC, *WIN))
    now[0] += 44
    _run(get_google_busy_intervals(ENC, *WIN))
    assert google.busy_calls == 1
    now[0] += 2                                                                  # past the 45 s TTL
    _run(get_google_busy_intervals(ENC, *WIN))
    assert google.busy_calls == 2


def test_the_cached_list_cannot_be_mutated_by_a_caller(google, caches_on):
    google.busy = [{"start": "2030-06-03T04:00:00Z", "end": "2030-06-03T05:00:00Z"}]
    first = _run(get_google_busy_intervals(ENC, *WIN))
    first[0]["start"] = "tampered"
    first.append({"start": "x", "end": "y"})
    assert _run(get_google_busy_intervals(ENC, *WIN)) == [{"start": "2030-06-03T04:00:00Z", "end": "2030-06-03T05:00:00Z"}]


def test_a_google_error_is_never_cached_and_never_looks_free(google, caches_on):
    google.busy_status = 500
    with pytest.raises(GoogleCalendarUnavailable):
        _run(get_google_busy_intervals(ENC, *WIN))
    google.busy_status = 200
    google.busy = [{"start": "2030-06-03T04:00:00Z", "end": "2030-06-03T05:00:00Z"}]
    assert _run(get_google_busy_intervals(ENC, *WIN)) == google.busy             # recovered at once, nothing poisoned


def test_a_revoked_token_is_dropped_and_retried_once(google, caches_on, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_FREEBUSY_CACHE_SECONDS", 0)
    _run(get_google_busy_intervals(ENC, *WIN))                                   # token cached
    google.reject_token_once = True                                              # Google now refuses that token
    assert _run(get_google_busy_intervals(ENC, *WIN)) == []
    assert google.token_calls == 2                                               # refreshed after the 401
    # And if the refresh itself is refused, the connection is dead: fail closed.
    google.reject_token_once = True
    google.token_status = 400
    with pytest.raises(GoogleCalendarUnavailable):
        _run(get_google_busy_intervals(ENC, *WIN))


def test_forgetting_busy_times_keeps_the_token(google, caches_on):
    _run(get_google_busy_intervals(ENC, *WIN))
    google_calendar.forget_google_busy(ENC)
    _run(get_google_busy_intervals(ENC, *WIN))
    assert google.busy_calls == 2 and google.token_calls == 1
    google_calendar.forget_google_account(ENC)
    _run(get_google_busy_intervals(ENC, *WIN))
    assert google.token_calls == 2


def test_two_accounts_never_share_cached_answers(google, caches_on):
    other = encrypt_secret("a-different-refresh-token")
    google.busy = [{"start": "2030-06-03T04:00:00Z", "end": "2030-06-03T05:00:00Z"}]
    _run(get_google_busy_intervals(ENC, *WIN))
    _run(get_google_busy_intervals(other, *WIN))
    assert google.busy_calls == 2 and google.token_calls == 2


# ---------------------------------------------------------------------------------------
# The slot endpoint
# ---------------------------------------------------------------------------------------

def _host(admin, db, days=range(7), connect_google=True):
    sess = client.post("/api/sessions/", headers=admin["headers"],
                       json={"title": "Call", "duration_minutes": 30, "price": 50000, "currency": "INR"}).json()
    for dow in days:
        db.add(AvailabilityRule(admin_id=admin["id"], day_of_week=dow, start_time="09:00", end_time="17:00", is_active=True))
    if connect_google:
        db.add(GoogleConnection(admin_id=admin["id"], google_email="g@example.com", encrypted_refresh_token=ENC,
                                connection_status="connected", calendar_id="primary"))
    db.commit()
    return sess


def _day(offset=2):
    return (datetime.utcnow() + timedelta(days=offset)).strftime("%Y-%m-%d")


def _slots(admin, session_id, day):
    r = client.get("/api/availability/slots", params={"username": admin["username"], "session_id": session_id, "date_str": day})
    assert r.status_code == 200, r.text
    return r.json()


class _Count:
    def __enter__(self):
        self.n = 0
        self._f = lambda *a, **k: setattr(self, "n", self.n + 1)
        event.listen(engine, "before_cursor_execute", self._f)
        return self

    def __exit__(self, *a):
        event.remove(engine, "before_cursor_execute", self._f)


def test_cached_slots_are_identical_to_uncached_slots(admin, db, google, monkeypatch):
    sess = _host(admin, db)
    google.busy = [{"start": f"{_day()}T04:30:00Z", "end": f"{_day()}T05:30:00Z"}]            # 10:00-11:00 IST
    uncached = _slots(admin, sess["id"], _day())
    monkeypatch.setattr(settings, "GOOGLE_TOKEN_CACHE_ENABLED", True)
    monkeypatch.setattr(settings, "GOOGLE_FREEBUSY_CACHE_SECONDS", 45)
    monkeypatch.setattr(settings, "AVAILABILITY_CONFIG_CACHE_SECONDS", 20)
    availability_cache.clear(); google_calendar.clear_google_caches()
    for _ in range(2):
        assert _slots(admin, sess["id"], _day()) == uncached
    assert "10:00" not in str(uncached["available_slots"])                                    # Google busy time respected


def test_a_warm_click_makes_far_fewer_queries_and_no_google_calls(admin, db, google, caches_on):
    sess = _host(admin, db)
    _slots(admin, sess["id"], _day())                                                          # warm everything
    google.token_calls = google.busy_calls = 0
    with _Count() as warm:
        _slots(admin, sess["id"], _day())
    assert (google.token_calls, google.busy_calls) == (0, 0)
    assert warm.n <= 3                                                                         # bookings + holds (+ at most one more)
    # For contrast: the uncached engine, measured the same way.
    settings.AVAILABILITY_CONFIG_CACHE_SECONDS = 0
    with _Count() as cold:
        _slots(admin, sess["id"], _day())
    assert cold.n >= 8 and warm.n < cold.n


def test_bookings_are_read_live_so_a_new_booking_blocks_its_slot_at_once(admin, db, google, caches_on):
    sess = _host(admin, db)
    day = _day()
    before = _slots(admin, sess["id"], day)["available_slots"]
    slot = before[0]
    start = f"{day}T{slot['start_time'] if 'start_time' in slot else slot}"                   # whatever shape the engine returns
    first = before[0]
    label = first if isinstance(first, str) else next(v for v in first.values() if isinstance(v, str) and ":" in v)
    hhmm = label[-5:] if len(label) >= 5 else label
    db.add(Booking(
        public_id=f"BK-SP-{uuid.uuid4().hex[:8].upper()}", admin_id=admin["id"], meeting_type_id=sess["id"],
        client_name="C", client_email="c@example.com", start_time=f"{day}T{hhmm}:00Z", end_time=f"{day}T{hhmm}:00Z",
        status="confirmed", payment_status="completed", cancellation_token=uuid.uuid4().hex))
    db.commit()
    assert len(_slots(admin, sess["id"], day)["available_slots"]) < len(before)


def test_editing_hours_leave_days_or_the_session_shows_up_immediately(admin, db, google, caches_on):
    sess = _host(admin, db)
    day = _day()
    assert _slots(admin, sess["id"], day)["available_slots"]
    h = admin["headers"]
    # leave day
    exc = client.post("/api/availability/exceptions", headers=h, json={"exception_date": day, "is_available": False})
    assert exc.status_code == 200, exc.text
    assert _slots(admin, sess["id"], day)["available_slots"] == []
    client.delete(f"/api/availability/exceptions/{exc.json()['id']}", headers=h)
    assert _slots(admin, sess["id"], day)["available_slots"]
    # working hours
    client.post("/api/availability/rules", headers=h, json={"rules": []})
    assert _slots(admin, sess["id"], day)["available_slots"] == []
    client.post("/api/availability/rules", headers=h, json={"rules": [
        {"day_of_week": d, "start_time": "09:00", "end_time": "10:00", "is_active": True} for d in range(7)]})
    short = _slots(admin, sess["id"], day)["available_slots"]
    assert 0 < len(short) <= 2
    # session length
    client.put(f"/api/sessions/{sess['id']}", headers=h, json={"duration_minutes": 60})
    assert len(_slots(admin, sess["id"], day)["available_slots"]) <= len(short)
    # deactivating the session
    client.put(f"/api/sessions/{sess['id']}", headers=h, json={"is_active": False})
    r = client.get("/api/availability/slots", params={"username": admin["username"], "session_id": sess["id"], "date_str": day})
    assert r.status_code == 404


def test_disconnecting_google_stops_google_lookups_at_once(admin, db, google, caches_on):
    sess = _host(admin, db)
    _slots(admin, sess["id"], _day())
    assert google.busy_calls >= 1
    r = client.post("/api/google/admin/disconnect", headers=admin["headers"])
    assert r.status_code == 200, r.text
    google.busy_calls = 0
    _slots(admin, sess["id"], _day())
    assert google.busy_calls == 0


def test_a_google_outage_pauses_booking_and_recovers_without_being_cached(admin, db, google, caches_on):
    sess = _host(admin, db)
    google.busy_status = 500
    paused = _slots(admin, sess["id"], _day())
    assert paused["available_slots"] == [] and paused.get("calendar_error") is True
    google.busy_status = 200
    assert _slots(admin, sess["id"], _day())["available_slots"]


def test_a_leave_day_never_calls_google(admin, db, google, caches_on):
    sess = _host(admin, db)
    day = _day()
    client.post("/api/availability/exceptions", headers=admin["headers"], json={"exception_date": day, "is_available": False})
    google.busy_calls = google.token_calls = 0
    assert _slots(admin, sess["id"], day)["available_slots"] == []
    assert (google.busy_calls, google.token_calls) == (0, 0)


def test_unknown_hosts_and_sessions_still_404_exactly_as_before(admin, db, google, caches_on):
    sess = _host(admin, db)
    r = client.get("/api/availability/slots", params={"username": "nobody-here", "session_id": sess["id"], "date_str": _day()})
    assert r.status_code == 404
    r = client.get("/api/availability/slots", params={"username": admin["username"], "session_id": "not-a-session", "date_str": _day()})
    assert r.status_code == 404


def test_two_hosts_never_see_each_others_cached_configuration(tracked, db, google, caches_on):
    a, b = _make_admin(tracked, "a"), _make_admin(tracked, "b")
    sa = _host(a, db, days=range(7))
    sb = _host(b, db, days=[], connect_google=False)
    client.post("/api/availability/rules", headers=b["headers"], json={"rules": []})            # b works on no days at all
    day = _day()
    assert _slots(a, sa["id"], day)["available_slots"]
    assert _slots(b, sb["id"], day)["available_slots"] == []
    assert _slots(a, sa["id"], day)["available_slots"]                                         # still a's, from cache
    # a's session id on b's page is refused, cached or not
    r = client.get("/api/availability/slots", params={"username": b["username"], "session_id": sa["id"], "date_str": day})
    assert r.status_code == 404


def test_slot_counts_match_with_and_without_the_cache(admin, db, google, monkeypatch):
    sess = _host(admin, db)
    google.busy = [{"start": f"{_day(1)}T04:00:00Z", "end": f"{_day(1)}T12:00:00Z"}]
    params = {"username": admin["username"], "session_id": sess["id"], "days": 7}
    plain = client.get("/api/availability/slot-counts", params=params).json()
    monkeypatch.setattr(settings, "GOOGLE_TOKEN_CACHE_ENABLED", True)
    monkeypatch.setattr(settings, "GOOGLE_FREEBUSY_CACHE_SECONDS", 45)
    monkeypatch.setattr(settings, "AVAILABILITY_CONFIG_CACHE_SECONDS", 20)
    availability_cache.clear(); google_calendar.clear_google_caches()
    for _ in range(2):
        assert client.get("/api/availability/slot-counts", params=params).json() == plain


def test_the_cache_holds_plain_copies_not_orm_objects(admin, db, google, caches_on):
    sess = _host(admin, db)
    _slots(admin, sess["id"], _day())
    snap = next(iter(availability_cache._cache.values()))[1]
    from types import SimpleNamespace
    assert isinstance(snap["user"], SimpleNamespace) and isinstance(snap["session_obj"], SimpleNamespace)
    assert all(isinstance(r, SimpleNamespace) for rows in snap["rules_by_dow"].values() for r in rows)
    assert "refresh-token-abc" not in str(snap)                                                # only the encrypted value


def test_a_renamed_booking_link_does_not_serve_a_stale_entry(admin, db, google, caches_on):
    sess = _host(admin, db)
    _slots(admin, sess["id"], _day())
    new_name = f"renamed{uuid.uuid4().hex[:6]}"
    r = client.put("/api/profiles/me", headers=admin["headers"], json={"username": new_name})
    assert r.status_code == 200, r.text
    ok = client.get("/api/availability/slots", params={"username": new_name, "session_id": sess["id"], "date_str": _day()})
    assert ok.status_code == 200
    gone = client.get("/api/availability/slots", params={"username": admin["username"], "session_id": sess["id"], "date_str": _day()})
    assert gone.status_code == 404


def test_one_google_answer_serves_every_date_and_the_date_strip(admin, db, google, caches_on):
    """Switching dates (and loading the date strip) must not ask Google again for each one."""
    sess = _host(admin, db)
    client.get("/api/availability/slot-counts", params={"username": admin["username"], "session_id": sess["id"], "days": 14})
    assert google.busy_calls == 1
    for offset in (1, 2, 5, 9, 14):
        _slots(admin, sess["id"], _day(offset))
    assert google.busy_calls == 1 and google.token_calls == 1


def test_a_busy_block_on_a_later_day_still_blocks_that_day_from_the_shared_window(admin, db, google, caches_on):
    sess = _host(admin, db)
    d10 = _day(10)
    google.busy = [{"start": f"{d10}T03:30:00Z", "end": f"{d10}T05:30:00Z"}]                  # 09:00-11:00 IST on day +10
    busy_day = _slots(admin, sess["id"], d10)["available_slots"]
    free_day = _slots(admin, sess["id"], _day(9))["available_slots"]
    assert len(busy_day) < len(free_day) and google.busy_calls == 1
