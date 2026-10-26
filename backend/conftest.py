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
