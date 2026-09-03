"""
Removes demo/seed/test admin accounts left in a development database by earlier versions
of the app and by the integration suite.

This script is deliberately NOT a migration and NOT part of startup: it deletes accounts,
so it must be run by a person who has read what it is about to do.

    cd backend
    python scripts/cleanup_demo_data.py            # list only, changes nothing
    python scripts/cleanup_demo_data.py --delete   # remove the listed accounts

What it targets, and nothing else:
  * the demo staff admins the old seeder created — alex@ / priya@ / david@adwaysacademy.com
  * accounts created by backend/test_api.py — arun*@testdomain.com and the test-only
    del_*@testdomain.com / gdel_*@testdomain.com / paytest_*@testdomain.com rows
  * an explicit list of extra emails passed with --also, for one-off residue

It never touches super admins, and it never matches on anything as loose as "test appears
somewhere in the name". Anything not matched by an exact rule is left alone -- run the
listing first and read it.

Deletion goes through the same services/admin_deletion.py path the Super Admin dashboard
uses, so demo accounts are erased exactly as a real deletion would erase them. Because
that path writes a tombstone blocking the email from registering again, --no-tombstone is
provided for demo cleanup, where you may well want alex@ to be reusable later.
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal  # noqa: E402
from app.core.security import hash_email  # noqa: E402
from app.models.models import (  # noqa: E402
    User,
    AdminProfile,
    Session as SessionModel,
    AvailabilityRule,
    AvailabilityException,
    GoogleConnection,
    RazorpayConnection,
    SlotLock,
    Notification,
    DeletedAdminIdentity,
)
from app.services.admin_deletion import permanently_delete_admin  # noqa: E402

# Exact addresses seeded by the removed demo-staff block in main.seed_initial_data().
DEMO_EMAILS = {
    "alex@adwaysacademy.com",
    "priya@adwaysacademy.com",
    "david@adwaysacademy.com",
}

# Accounts created by the test suites against the shared dev database.
TEST_EMAIL_PATTERNS = [
    re.compile(r"^arun(_[0-9a-f]+)?@testdomain\.com$", re.I),
    re.compile(r"^del_[a-z0-9]+_[0-9a-f]+@testdomain\.com$", re.I),
    re.compile(r"^gdel_[0-9a-f]+@testdomain\.com$", re.I),
    re.compile(r"^paytest_[0-9a-f]+@testdomain\.com$", re.I),
    re.compile(r"^gtest_[0-9a-f]+@example\.com$", re.I),
    re.compile(r"^imp_[0-9a-f]+@testdomain\.com$", re.I),
    re.compile(r"^apitest_[0-9a-f]+@testdomain\.com$", re.I),
]


def classify(user, extra_emails):
    email = (user.email or "").strip().lower()
    if user.role == "super_admin":
        return None  # never targeted
    if email in DEMO_EMAILS:
        return "demo seed account"
    if email in extra_emails:
        return "explicitly listed (--also)"
    for pattern in TEST_EMAIL_PATTERNS:
        if pattern.match(email):
            return "automated test residue"
    return None


ADMIN_OWNED_TABLES = [
    (Notification, "admin_id"),
    (SlotLock, "admin_id"),
    (AvailabilityException, "admin_id"),
    (AvailabilityRule, "admin_id"),
    (GoogleConnection, "admin_id"),
    (RazorpayConnection, "admin_id"),
    (SessionModel, "admin_id"),
    (AdminProfile, "user_id"),
]


def find_orphans(db):
    """Rows whose owning admin no longer exists (residue from the old delete path)."""
    live_ids = {row[0] for row in db.query(User.id).all()}
    found = {}
    for model, column in ADMIN_OWNED_TABLES:
        stale = [r for r in db.query(model).all() if getattr(r, column) not in live_ids]
        if stale:
            found[model] = stale
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delete", action="store_true", help="actually remove the listed accounts")
    parser.add_argument("--no-tombstone", action="store_true",
                        help="do not block these emails from registering again (recommended for demo cleanup)")
    parser.add_argument("--also", default="", help="comma-separated extra emails to treat as demo data")
    args = parser.parse_args()

    extra_emails = {e.strip().lower() for e in args.also.split(",") if e.strip()}

    db = SessionLocal()
    try:
        users = db.query(User).order_by(User.created_at.asc()).all()
        targets, keepers = [], []
        for user in users:
            verdict = classify(user, extra_emails)
            (targets if verdict else keepers).append((user, verdict))

        print(f"\n{len(users)} accounts in {db.bind.url.render_as_string(hide_password=True)}\n")

        print("WILL BE DELETED:")
        if not targets:
            print("  (none)")
        for user, verdict in targets:
            profile = db.query(AdminProfile).filter(AdminProfile.user_id == user.id).first()
            username = profile.username if profile else "-"
            print(f"  {user.email:45} @{username:20} role={user.role:12} [{verdict}]")

        print("\nWILL BE KEPT:")
        for user, _ in keepers:
            profile = db.query(AdminProfile).filter(AdminProfile.user_id == user.id).first()
            username = profile.username if profile else "-"
            print(f"  {user.email:45} @{username:20} role={user.role}")

        orphans = find_orphans(db)
        if orphans:
            print("")
            print("ORPHANED ROWS (owning admin no longer exists):")
            for model, rows in orphans.items():
                print(f"  {model.__tablename__:26} {len(rows)}")


        if not args.delete:
            print("\nListing only. Re-run with --delete to remove the accounts above.")
            return 0

        if orphans:
            for model, rows in orphans.items():
                for row in rows:
                    db.delete(row)
            db.commit()
            print(f"Removed orphaned rows from {len(orphans)} table(s).")


        if not targets:
            print("\nNothing to delete.")
            return 0

        print(f"\nDeleting {len(targets)} accounts...")
        removed = 0
        for user, _ in targets:
            email = user.email
            summary = permanently_delete_admin(db, user, deleted_by=None, reason="demo/test data cleanup")
            if args.no_tombstone:
                db.query(DeletedAdminIdentity).filter(
                    DeletedAdminIdentity.email_hash == hash_email(email)
                ).delete(synchronize_session=False)
                db.commit()
            removed += 1
            print(f"  removed {email} ({summary['sessions_deleted']} sessions, "
                  f"{summary['availability_rules_deleted']} availability rules)")

        print(f"\nDone. {removed} accounts removed. "
              f"{'No re-registration blocks were kept.' if args.no_tombstone else 'Their emails are now blocked from re-registering.'}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
