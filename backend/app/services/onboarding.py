"""
First-time setup status for one admin, derived from persisted rows only.

The dashboard checklist used to compute this in the browser: "Working Hours" was hardcoded
done, "Connect Gateway" hardcoded not done, and the other two read an auth store that was
never populated. It showed "1 of 4" to admins who had finished three steps. This module is
now the only place that decides, and every query is scoped to the admin being asked about.
"""
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import (
    AdminOnboarding,
    AdminProfile,
    AvailabilityRule,
    RazorpayConnection,
    Session as SessionModel,
    User,
)

STEP_KEYS = ("profile", "working_hours", "meeting_type", "gateway")


def _filled(value) -> bool:
    return bool(value and str(value).strip())


def profile_step_done(user: User, profile: AdminProfile | None) -> bool:
    """A name, a username for the public URL, and a saved profile photo."""
    return bool(
        profile is not None
        and _filled(user.name)
        and _filled(profile.username)
        and _filled(profile.profile_photo)
    )


def working_hours_step_done(db: Session, admin_id: str) -> bool:
    """At least one active weekly range whose end is after its start."""
    rules = (
        db.query(AvailabilityRule)
        .filter(AvailabilityRule.admin_id == admin_id, AvailabilityRule.is_active == True)  # noqa: E712
        .all()
    )
    # Stored as "HH:MM" by availability.save_my_availability_rules, so strings compare in order.
    return any(
        _filled(r.start_time) and _filled(r.end_time) and r.start_time[:5] < r.end_time[:5]
        for r in rules
    )


def meeting_type_step_done(db: Session, admin_id: str) -> bool:
    """At least one active session a client could actually book. Deleted sessions are gone."""
    sessions = (
        db.query(SessionModel)
        .filter(SessionModel.admin_id == admin_id, SessionModel.is_active == True)  # noqa: E712
        .all()
    )
    return any(
        _filled(s.title) and (s.duration_minutes or 0) > 0 and (s.price or 0) >= 0
        for s in sessions
    )


def gateway_step_done(db: Session, admin_id: str) -> bool:
    """This admin's own Razorpay connection, stored and not disconnected by them.

    Deliberately reads the row, never a live probe: a Razorpay outage must not make a
    connected gateway look unconnected.
    """
    conn = db.query(RazorpayConnection).filter(RazorpayConnection.admin_id == admin_id).first()
    return bool(
        conn
        and conn.connection_status == "connected"
        and _filled(conn.key_id)
        and _filled(conn.encrypted_key_secret)
    )


def get_onboarding_status(db: Session, user: User) -> dict:
    profile = user.profile
    steps = {
        "profile": profile_step_done(user, profile),
        "working_hours": working_hours_step_done(db, user.id),
        "meeting_type": meeting_type_step_done(db, user.id),
        "gateway": gateway_step_done(db, user.id),
    }
    completed_count = sum(1 for key in STEP_KEYS if steps[key])

    record = db.query(AdminOnboarding).filter(AdminOnboarding.admin_id == user.id).first()
    if record is None and completed_count == len(STEP_KEYS):
        # First time every step is done: remember it, once. Later regressions (a
        # disconnected gateway) show on the checklist but never send them back to setup.
        record = AdminOnboarding(admin_id=user.id)
        db.add(record)
        try:
            db.commit()
        except IntegrityError:
            # A concurrent request wrote it first; that is the same outcome.
            db.rollback()
            record = db.query(AdminOnboarding).filter(AdminOnboarding.admin_id == user.id).first()

    username = profile.username.strip() if profile is not None and _filled(profile.username) else None

    return {
        **steps,
        "completed_count": completed_count,
        "total_count": len(STEP_KEYS),
        "setup_completed": record is not None,
        "setup_completed_at": record.completed_at.isoformat() if record and record.completed_at else None,
        "username": username,
        # From the database, so the client never decides from its own storage who is exempt
        # from the setup screen (a super admin is sent to their own console, not setup).
        "role": user.role,
    }
