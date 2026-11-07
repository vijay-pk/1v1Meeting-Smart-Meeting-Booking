"""
The public booking-page payload is cached briefly (services/public_profile_cache.py). These tests
pin the two promises that make that safe: a repeat visit costs no database work, and any write
through the API is visible on the very next page load -- never an old bio, price or status.
"""
import uuid

import pytest
from sqlalchemy import event

from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.services import public_profile_cache
from test_public_profile import client, tracked, _make_admin, _public, PASSWORD  # noqa: F401


@pytest.fixture
def cache_on(monkeypatch):
    monkeypatch.setattr(settings, "PUBLIC_PROFILE_CACHE_SECONDS", 60, raising=False)
    public_profile_cache.clear()
    yield
    public_profile_cache.clear()


def _count_queries():
    counter = {"n": 0}

    def bump(*_args, **_kwargs):
        counter["n"] += 1

    event.listen(engine, "before_cursor_execute", bump)
    return counter, lambda: event.remove(engine, "before_cursor_execute", bump)


def test_repeat_visit_does_no_database_work(cache_on, tracked):
    admin = _make_admin(tracked, "c")
    first = _public(admin["username"])
    assert first.status_code == 200
    counter, stop = _count_queries()
    try:
        second = _public(admin["username"])
    finally:
        stop()
    assert second.status_code == 200
    assert second.json() == first.json()
    assert counter["n"] == 0


def test_lookup_is_case_insensitive_and_shares_the_entry(cache_on, tracked):
    admin = _make_admin(tracked, "d")
    assert _public(admin["username"]).status_code == 200
    counter, stop = _count_queries()
    try:
        res = _public(admin["username"].upper())
    finally:
        stop()
    assert res.status_code == 200
    assert counter["n"] == 0


def test_an_api_write_is_visible_on_the_next_load(cache_on, tracked):
    admin = _make_admin(tracked, "e")
    before = _public(admin["username"]).json()
    bio = f"Fresh bio {uuid.uuid4().hex[:6]}"
    assert before["bio"] != bio
    res = client.put("/api/profiles/me", headers=admin["headers"], json={"bio": bio})
    assert res.status_code == 200, res.text
    assert _public(admin["username"]).json()["bio"] == bio


def test_a_failed_lookup_is_never_cached(cache_on, tracked):
    username = f"pubf{uuid.uuid4().hex[:8]}"
    assert _public(username).status_code == 404
    res = client.post("/api/auth/signup", json={
        "name": "Late", "email": f"{username}@testdomain.com", "password": PASSWORD, "username": username,
    })
    assert res.status_code == 200, res.text
    tracked.append(res.json()["user_id"])
    assert _public(username).status_code == 200


def test_the_cache_is_off_when_the_ttl_is_zero(tracked, monkeypatch):
    monkeypatch.setattr(settings, "PUBLIC_PROFILE_CACHE_SECONDS", 0, raising=False)
    admin = _make_admin(tracked, "g")
    _public(admin["username"])
    counter, stop = _count_queries()
    try:
        _public(admin["username"])
    finally:
        stop()
    assert counter["n"] > 0


def test_an_entry_expires(cache_on, tracked, monkeypatch):
    admin = _make_admin(tracked, "h")
    _public(admin["username"])
    now = public_profile_cache.time.monotonic()
    monkeypatch.setattr(public_profile_cache.time, "monotonic", lambda: now + 61)
    counter, stop = _count_queries()
    try:
        _public(admin["username"])
    finally:
        stop()
    assert counter["n"] > 0
