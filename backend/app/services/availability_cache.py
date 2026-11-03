"""
A short-lived cache of a host's slow-changing availability configuration.

Why: one slot click used to cost nine database round trips (host, session, its hours, the
weekday's rules, leave days, the Google link, and so on) before any Google call. With the backend
and database in different regions each round trip is hundreds of milliseconds, so the page felt
slow however fast the code was. The things below almost never change between two clicks, so they
are read once and reused for AVAILABILITY_CONFIG_CACHE_SECONDS.

What is NOT cached, ever: bookings and slot holds. Those are read live on every request, so two
visitors can never be offered the same slot because of this cache. (Google busy times have their own
short cache in google_calendar.)

What is cached: the host's id/status, the session's duration, buffers, notice and horizon, its
weekday windows, the host's weekly rules, leave/holiday exceptions from today on, and which Google
account is connected. Every write path that changes any of that calls invalidate_admin(), and the
TTL bounds the damage if one is ever missed.

Snapshots hold plain copies (SimpleNamespace), never ORM instances, so they stay valid after the
request's database session has closed.
"""
import time
from datetime import datetime
from types import SimpleNamespace
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.models.models import (
    AdminProfile, AvailabilityException, AvailabilityRule, GoogleConnection, Session as SessionModel, User,
)

_cache: dict = {}          # key -> (monotonic expiry, snapshot)
_MAX_ENTRIES = 1000


def enabled() -> bool:
    return (settings.AVAILABILITY_CONFIG_CACHE_SECONDS or 0) > 0


def clear() -> None:
    _cache.clear()


def invalidate_admin(admin_id: Optional[str]) -> None:
    """Forget everything cached for one host. Call after any write to their sessions, hours, leave
    days, Google connection, status or username."""
    if not admin_id:
        return
    for key in [k for k, (_, snap) in _cache.items() if snap["user"].id == admin_id]:
        _cache.pop(key, None)


def _load(db: Session, admin_id: Optional[str], username: Optional[str], session_id: str) -> Optional[dict]:
    user = None
    if admin_id:
        user = db.query(User).filter(User.id == admin_id).first()
    elif username:
        profile = db.query(AdminProfile).filter(AdminProfile.username == username.lower()).first()
        if profile:
            user = profile.user
    if not user:
        return None

    s = (
        db.query(SessionModel)
        .options(selectinload(SessionModel.time_windows))
        .filter(SessionModel.id == session_id, SessionModel.admin_id == user.id)
        .first()
    )
    if not s:
        return None

    today = datetime.now(ZoneInfo(settings.BUSINESS_TIMEZONE)).strftime("%Y-%m-%d")
    rules_by_dow: dict = {}
    for r in (
        db.query(AvailabilityRule)
        .filter(AvailabilityRule.admin_id == user.id, AvailabilityRule.is_active == True)  # noqa: E712
        .order_by(AvailabilityRule.start_time.asc())
        .all()
    ):
        rules_by_dow.setdefault(r.day_of_week, []).append(
            SimpleNamespace(day_of_week=r.day_of_week, start_time=r.start_time, end_time=r.end_time))

    exceptions_by_date: dict = {}
    for ex in (
        db.query(AvailabilityException)
        .filter(AvailabilityException.admin_id == user.id, AvailabilityException.exception_date >= today)
        .all()
    ):
        exceptions_by_date.setdefault(ex.exception_date, []).append(SimpleNamespace(
            exception_date=ex.exception_date, is_available=ex.is_available,
            start_time=ex.start_time, end_time=ex.end_time))

    g = (
        db.query(GoogleConnection)
        .filter(GoogleConnection.admin_id == user.id, GoogleConnection.connection_status == "connected")
        .first()
    )
    return {
        "user": SimpleNamespace(id=user.id, status=user.status),
        "session_obj": SimpleNamespace(
            id=s.id, is_active=s.is_active, duration_minutes=s.duration_minutes,
            buffer_before_minutes=s.buffer_before_minutes, buffer_after_minutes=s.buffer_after_minutes,
            min_advance_hours=s.min_advance_hours, max_advance_days=s.max_advance_days,
            time_windows=[SimpleNamespace(day_of_week=w.day_of_week, start_time=w.start_time, end_time=w.end_time)
                          for w in (s.time_windows or [])],
        ),
        "rules_by_dow": rules_by_dow,
        "exceptions_by_date": exceptions_by_date,
        "google": (
            SimpleNamespace(encrypted_refresh_token=g.encrypted_refresh_token, calendar_id=g.calendar_id)
            if g and g.encrypted_refresh_token else None
        ),
    }


def get_snapshot(db: Session, admin_id: Optional[str], username: Optional[str], session_id: str) -> Optional[dict]:
    """The cached snapshot, loading it on a miss. None = unknown host/session: callers fall back to
    the uncached path, which produces the same 404s as before."""
    key = (admin_id, (username or "").lower() or None, session_id)
    hit = _cache.get(key)
    now = time.monotonic()
    if hit and hit[0] > now:
        return hit[1]
    snap = _load(db, admin_id, username, session_id)
    if snap is None:
        _cache.pop(key, None)
        return None
    if len(_cache) >= _MAX_ENTRIES:
        for k in [k for k, v in _cache.items() if v[0] <= now] or list(_cache)[: _MAX_ENTRIES // 4]:
            _cache.pop(k, None)
    _cache[key] = (now + settings.AVAILABILITY_CONFIG_CACHE_SECONDS, snap)
    return snap
