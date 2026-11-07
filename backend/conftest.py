"""
Test-suite-wide safety.

On a developer machine backend/.env holds the REAL Resend credentials, so any test that confirms
a booking or creates a student would otherwise send real email through the production Resend
account (to addresses like stud_ab12cd@testdomain.com, and to a seeded Super Admin's address).
Email is switched off for every test; a test that needs it on sets its own values, and
tests of the sender stub it.
"""
import pytest

from app.core.config import settings


@pytest.fixture(autouse=True)
def _never_send_real_email(monkeypatch):
    # EMAIL_ENABLED is true only when BOTH of these are set, so blanking one disables sending.
    monkeypatch.setattr(settings, "RESEND_API_KEY", "", raising=False)


@pytest.fixture(autouse=True)
def _speed_caches_off_by_default(monkeypatch):
    """
    The slot-availability caches (Google token, FreeBusy, host configuration) are ON in production and
    OFF here by default: most tests edit rows directly and mock Google per test, so a cache surviving
    from one test into the next would test the cache instead of the code. The caching tests switch
    them on explicitly (see test_slot_speed.py).
    """
    from app.services import availability_cache, google_calendar, public_profile_cache
    monkeypatch.setattr(settings, "GOOGLE_TOKEN_CACHE_ENABLED", False, raising=False)
    monkeypatch.setattr(settings, "GOOGLE_FREEBUSY_CACHE_SECONDS", 0, raising=False)
    monkeypatch.setattr(settings, "AVAILABILITY_CONFIG_CACHE_SECONDS", 0, raising=False)
    monkeypatch.setattr(settings, "PUBLIC_PROFILE_CACHE_SECONDS", 0, raising=False)
    availability_cache.clear()
    google_calendar.clear_google_caches()
    public_profile_cache.clear()
    yield
    availability_cache.clear()
    google_calendar.clear_google_caches()
    public_profile_cache.clear()
