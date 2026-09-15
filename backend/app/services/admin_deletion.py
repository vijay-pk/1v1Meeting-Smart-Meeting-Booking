"""
Permanent deletion of an admin account.

This is the destructive counterpart to `PUT /super-admin/admins/{id}/status`, which only
suspends. Here the account and everything that identifies its owner is actually removed
from the database; what survives is deliberate and documented below.

Removed outright
    admin profile, session types, availability rules and exceptions, slot locks,
    notifications, Google Calendar connection (with its encrypted refresh token),
    Razorpay connection (with its encrypted key secret), and the user row itself.

Retained, stripped of personal data
    bookings and payments. A payment is a financial record: deleting it would erase money
    that actually moved through a merchant account, and the platform's revenue analytics
    sum over it. So the rows stay, but the booking is scrubbed of every personal field
    (client name, email, phone, notes, meeting link, calendar event id) and both rows are
    detached from the deleted user (`admin_id = NULL`). Nothing identifying the admin or
    their clients remains, and no foreign key points at a row that no longer exists.

Left behind
    one `DeletedAdminIdentity` row: a keyed hash of the email plus the freed username.
    Not an account -- see the model docstring for why it exists.
"""
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.core.security import hash_email, normalize_email
from app.models.models import (
    AdminOnboarding,
    User,
    AdminProfile,
    Session as SessionModel,
    AvailabilityRule,
    AvailabilityException,
    GoogleConnection,
    MediaAsset,
    RazorpayConnection,
    SlotLock,
    Booking,
    Payment,
    Notification,
    DeletedAdminIdentity,
)

logger = logging.getLogger(__name__)


class AdminDeletionError(Exception):
    """Raised when the deletion cannot be completed; the caller rolls back."""


def is_email_blocked(db: Session, email: str) -> bool:
    """True when this address belonged to a permanently deleted admin."""
    if not email:
        return False
    digest = hash_email(email)
    return (
        db.query(DeletedAdminIdentity)
        .filter(DeletedAdminIdentity.email_hash == digest)
        .first()
        is not None
    )


def is_username_retired(db: Session, username: str) -> bool:
    """True when this vanity URL belonged to a permanently deleted admin."""
    clean = (username or "").strip().lower()
    if not clean:
        return False
    return (
        db.query(DeletedAdminIdentity)
        .filter(DeletedAdminIdentity.username == clean)
        .first()
        is not None
    )


def _delete_storage_objects(paths: list) -> None:
    """Removes stored media objects, never raising: the account is already deleted."""
    if not paths:
        return
    import asyncio

    from app.services.supabase_storage import delete_object, is_configured

    if not is_configured():
        return
    try:
        async def _run():
            for path in paths:
                await delete_object(path)

        asyncio.run(_run())
    except Exception as exc:                                    # noqa: BLE001 - best effort
        logger.warning(f"Could not remove stored media objects {paths}: {exc}")


def permanently_delete_admin(
    db: Session,
    admin: User,
    *,
    deleted_by: Optional[str] = None,
    reason: Optional[str] = None,
) -> dict:
    """
    Deletes `admin` and all admin-owned data in a single transaction.

    The caller is responsible for authorization. This function commits on success and
    rolls back on any failure, so a half-deleted account is never left behind.

    Idempotent in the sense that matters: the tombstone is created only if absent, so a
    repeated call for an already-deleted admin (which cannot resolve a user anyway)
    cannot produce a duplicate-key error, and re-deleting after a partial failure works.

    Returns a summary of what was removed, for the audit log and the API response.
    """
    admin_id = admin.id
    email = normalize_email(admin.email)
    profile = db.query(AdminProfile).filter(AdminProfile.user_id == admin_id).first()
    username = profile.username.strip().lower() if profile and profile.username else None

    try:
        # 1. Tombstone first, inside the same transaction. If anything below fails the
        #    rollback takes this with it, so we never block an email for an account that
        #    still exists.
        digest = hash_email(email)
        existing_tombstone = (
            db.query(DeletedAdminIdentity)
            .filter(DeletedAdminIdentity.email_hash == digest)
            .first()
        )
        if not existing_tombstone:
            db.add(DeletedAdminIdentity(
                email_hash=digest,
                username=username,
                deleted_by=deleted_by,
                reason=(reason or None),
            ))
        elif username and not existing_tombstone.username:
            existing_tombstone.username = username

        # 2. Anonymize the financial trail before the user row goes away.
        bookings = db.query(Booking).filter(Booking.admin_id == admin_id).all()
        for booking in bookings:
            booking.client_name = "[deleted]"
            booking.client_email = "[deleted]"
            booking.client_phone = None
            booking.notes = None
            booking.google_meet_link = None
            booking.google_event_id = None
            booking.admin_id = None
            booking.meeting_type_id = None
            if booking.status in ("pending_payment", "confirmed"):
                booking.status = "cancelled"

        payments_detached = (
            db.query(Payment)
            .filter(Payment.admin_id == admin_id)
            .update({Payment.admin_id: None}, synchronize_session=False)
        )

        # 3. Delete admin-owned rows. Explicit rather than relying on database cascades:
        #    SQLite does not enforce foreign keys by default, and the ORM relationships do
        #    not cover every table (notifications, slot locks, exceptions).
        notifications_deleted = (
            db.query(Notification)
            .filter(Notification.admin_id == admin_id)
            .delete(synchronize_session=False)
        )
        locks_deleted = (
            db.query(SlotLock)
            .filter(SlotLock.admin_id == admin_id)
            .delete(synchronize_session=False)
        )
        exceptions_deleted = (
            db.query(AvailabilityException)
            .filter(AvailabilityException.admin_id == admin_id)
            .delete(synchronize_session=False)
        )
        rules_deleted = (
            db.query(AvailabilityRule)
            .filter(AvailabilityRule.admin_id == admin_id)
            .delete(synchronize_session=False)
        )
        google_deleted = (
            db.query(GoogleConnection)
            .filter(GoogleConnection.admin_id == admin_id)
            .delete(synchronize_session=False)
        )
        razorpay_deleted = (
            db.query(RazorpayConnection)
            .filter(RazorpayConnection.admin_id == admin_id)
            .delete(synchronize_session=False)
        )
        sessions_deleted = (
            db.query(SessionModel)
            .filter(SessionModel.admin_id == admin_id)
            .delete(synchronize_session=False)
        )
        db.query(AdminOnboarding).filter(AdminOnboarding.admin_id == admin_id).delete(
            synchronize_session=False
        )
        # Their uploaded media goes with the account. The rows are deleted explicitly rather
        # than left to the foreign key, because SQLite only enforces ON DELETE CASCADE when
        # the pragma is on. The stored objects are collected first and removed from Supabase
        # Storage after the transaction commits: an object deleted inside the transaction
        # could not be brought back if the transaction then rolled back.
        orphaned_objects = [
            row.storage_path
            for row in db.query(MediaAsset).filter(MediaAsset.owner_id == admin_id).all()
            if row.storage_path
        ]
        db.query(MediaAsset).filter(MediaAsset.owner_id == admin_id).delete(synchronize_session=False)
        profiles_deleted = (
            db.query(AdminProfile)
            .filter(AdminProfile.user_id == admin_id)
            .delete(synchronize_session=False)
        )

        # 4. The account itself. expunge first so the ORM does not try to re-apply the
        #    relationship cascades we have already handled by hand.
        db.expire(admin)
        db.query(User).filter(User.id == admin_id).delete(synchronize_session=False)

        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error(f"Permanent deletion of admin {admin_id} failed and was rolled back: {exc}")
        raise AdminDeletionError("Deletion failed and was rolled back; no data was removed.") from exc

    # The rows are gone and committed; now discard the objects they referenced. Best effort
    # and deliberately after the commit -- an orphaned object in a bucket is untidy, while a
    # deletion that fails here after the account is already gone would be a real problem.
    _delete_storage_objects(orphaned_objects)

    summary = {
        "admin_id": admin_id,
        "username": username,
        "profile_deleted": bool(profiles_deleted),
        "sessions_deleted": sessions_deleted,
        "availability_rules_deleted": rules_deleted,
        "availability_exceptions_deleted": exceptions_deleted,
        "slot_locks_deleted": locks_deleted,
        "notifications_deleted": notifications_deleted,
        "google_connection_deleted": bool(google_deleted),
        "razorpay_connection_deleted": bool(razorpay_deleted),
        "bookings_anonymized": len(bookings),
        "payments_detached": payments_detached,
    }
    logger.info(f"Admin {admin_id} permanently deleted: {summary}")
    return summary
