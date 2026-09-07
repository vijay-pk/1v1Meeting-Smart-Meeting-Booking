"""
Applies migration 004 -- the partial unique index that prevents double booking.

    cd backend
    python scripts/apply_booking_constraints_migration.py            # apply
    python scripts/apply_booking_constraints_migration.py --check    # report only

Idempotent on PostgreSQL and SQLite, additive, and deletes nothing.

The one thing that can stop it: rows that already violate the constraint. Two confirmed
bookings for the same admin and start time cannot both exist once the index is in place, and
the database will refuse to build it. Rather than fail with an opaque IntegrityError, this
script looks for those rows first and prints them, so a human decides which booking is real.
That is deliberately not automated -- picking which of two paying customers loses their slot
is not a decision a migration script should make.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.core.database import engine  # noqa: E402

INDEX_NAME = "ux_bookings_admin_slot_active"

CREATE_INDEX = """
CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_admin_slot_active
    ON bookings (admin_id, start_time)
    WHERE status IN ('confirmed', 'pending_payment')
"""

FIND_CONFLICTS = """
SELECT admin_id, start_time, COUNT(*) AS n
FROM bookings
WHERE status IN ('confirmed', 'pending_payment') AND admin_id IS NOT NULL
GROUP BY admin_id, start_time
HAVING COUNT(*) > 1
"""


def index_exists(conn) -> bool:
    return INDEX_NAME in {ix["name"] for ix in inspect(conn).get_indexes("bookings")}


def find_conflicts(conn):
    return list(conn.execute(text(FIND_CONFLICTS)))


def main() -> int:
    check_only = "--check" in sys.argv

    with engine.connect() as conn:
        if "bookings" not in inspect(conn).get_table_names():
            print("bookings table absent -- nothing to do (create_all has not run yet).")
            return 0

        already = index_exists(conn)
        print(f"  database          : {engine.url.get_backend_name()}")
        print(f"  {INDEX_NAME} : {'present' if already else 'MISSING'}")

        conflicts = find_conflicts(conn)
        if conflicts:
            print(f"\n  {len(conflicts)} slot(s) already double-booked -- the index cannot be built:")
            for row in conflicts:
                print(f"    admin {row.admin_id}  {row.start_time}  x{row.n}")
            print("\n  Resolve these first: cancel the duplicate booking(s), then re-run.")
            return 1

        if already:
            print("\n  Nothing to do.")
            return 0

        if check_only:
            print("\n  --check: no changes made. Re-run without --check to apply.")
            return 0

        # The conflict query above already autobegan a transaction on this connection
        # (SQLAlchemy 2.0), so commit that one rather than opening a second.
        conn.execute(text(CREATE_INDEX))
        conn.commit()
        print(f"\n  created {INDEX_NAME}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
