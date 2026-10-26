"""
Development-only simulation of the student recording workflow.

Nothing here talks to Google. A simulated entry is a TEST row: it has no video, its title starts
with "[TEST]", and it is marked by SIM_SPACE_PREFIX on the space id (so no schema change is
needed and a real Meet space id can never collide with it).

Production safety is enforced on the BACKEND by simulation_allowed(), which needs ALL of:
  1. settings.RECORDING_SIMULATION_ENABLED (env flag, default off)
  2. APP_URL pointing at a local / reserved-.test host (a deployed site never matches)
  3. settings.RECORDING_RETRIEVAL_ENABLED off, so simulated and real rows are never mixed
Every simulation endpoint re-checks it per request and answers 404 otherwise.
"""
import logging
from urllib.parse import urlparse

from app.core.config import settings

logger = logging.getLogger(__name__)

SIM_SPACE_PREFIX = "spaces/SIMULATED-"
TEST_TITLE_PREFIX = "[TEST] "
TEST_EMAIL_DOMAIN = "bookmymeet.test"  # reserved TLD: cannot receive mail
TEST_LABEL = "TEST - simulated entry, no video exists"


def is_simulated_space(space_name: str | None) -> bool:
    return bool(space_name) and space_name.startswith(SIM_SPACE_PREFIX)


def is_simulated(row) -> bool:
    """True for a MeetingRecording created by the simulation."""
    return is_simulated_space(getattr(row, "space_name", None))


def is_test_email(email: str | None) -> bool:
    e = (email or "").strip().lower()
    return e.endswith(".test")  # covers @bookmymeet.test and any other reserved-.test address


def _app_host_is_local() -> bool:
    host = (urlparse(settings.APP_URL or "").hostname or "").lower()
    return host in ("localhost", "127.0.0.1", "::1") or host.endswith(".localhost") or host.endswith(".test")


def simulation_allowed() -> bool:
    """The single backend gate for every simulation code path."""
    return bool(
        settings.RECORDING_SIMULATION_ENABLED
        and _app_host_is_local()
        and not settings.RECORDING_RETRIEVAL_ENABLED
    )


def log_simulation_state() -> None:
    """Startup note. Loud when the flag is on but the safety checks refuse it."""
    if not settings.RECORDING_SIMULATION_ENABLED:
        return
    if simulation_allowed():
        logger.warning("Recording SIMULATION is active (dev only). Entries are TEST-labelled and never emailed.")
    else:
        logger.error(
            "RECORDING_SIMULATION_ENABLED is set but REFUSED: APP_URL must be a local/.test host and "
            "RECORDING_RETRIEVAL_ENABLED must be off. Simulation endpoints will answer 404."
        )
