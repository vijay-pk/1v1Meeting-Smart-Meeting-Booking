"""
A short-lived cache of the finished public booking-page payload (`GET /profiles/public/{username}`).

Why: that one response costs about six sequential database round trips (profile, user, sessions,
Razorpay link, Google link, sections, section items, assets). With the backend and the database in
different regions each round trip is hundreds of milliseconds, so a visitor waited seconds for a
page whose content changes a few times a month.

Correctness: the payload is public and carries no per-viewer data. Any state-changing request
anywhere in the API (POST/PUT/PATCH/DELETE) clears the whole cache in `main.py`, so an admin who
changes a price, a session, a section, a photo, a connection or their status sees it on the next
page load; the TTL only bounds the damage if a write ever bypasses the API (a manual database edit).
Only successful lookups are cached -- a 404 is never stored, so a freshly created page is reachable
at once. Booking, payment, availability and allowance decisions never read this cache.
"""
import time
from typing import Optional

from app.core.config import settings

_cache: dict = {}          # lowercase username -> (monotonic expiry, payload)
_MAX_ENTRIES = 500


def enabled() -> bool:
    return (settings.PUBLIC_PROFILE_CACHE_SECONDS or 0) > 0


def clear() -> None:
    _cache.clear()


def get(key: str) -> Optional[dict]:
    if not enabled():
        return None
    hit = _cache.get(key)
    if hit is None:
        return None
    if hit[0] < time.monotonic():
        _cache.pop(key, None)
        return None
    return hit[1]


def put(key: str, payload: dict) -> None:
    if not enabled():
        return
    if len(_cache) >= _MAX_ENTRIES:
        _cache.clear()
    _cache[key] = (time.monotonic() + settings.PUBLIC_PROFILE_CACHE_SECONDS, payload)
