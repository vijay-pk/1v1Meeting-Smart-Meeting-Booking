"""
Applies migration 005 -- bookings.reschedule_token.

    cd backend
    python scripts/apply_reschedule_token_migration.py            # apply
    python scripts/apply_reschedule_token_migration.py --check    # report only

Idempotent on PostgreSQL and SQLite, additive, deletes nothing. create_all adds whole tables
but never a column on an existing table, so this is the only way the column reaches a database
that was built before rescheduling existed.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.core.database import engine  # noqa: E402

COLUMN = "reschedule_token"
INDEX_NAME = "ux_bookings_reschedule_token"


def column_exists(conn) -> bool:
    return COLUMN in {c["name"] for c in inspect(conn).get_columns("bookings")}


def index_exists(conn) -> bool:
    return INDEX_NAME in {ix["name"] for ix in inspect(conn).get_indexes("bookings")}


def main() -> int:
    check_only = "--check" in sys.argv

    with engine.connect() as conn:
        if "bookings" not in inspect(conn).get_table_names():
            print("bookings table absent -- nothing to do (create_all has not run yet).")
            return 0

        has_col = column_exists(conn)
        has_idx = index_exists(conn)
        print(f"  database   : {engine.url.get_backend_name()}")
        print(f"  {COLUMN} column : {'present' if has_col else 'MISSING'}")
        print(f"  {INDEX_NAME} : {'present' if has_idx else 'MISSING'}")

        if has_col and has_idx:
            print("\n  Nothing to do.")
            return 0

        if check_only:
            print("\n  --check: no changes made. Re-run without --check to apply.")
            return 0

        if not has_col:
            conn.execute(text("ALTER TABLE bookings ADD COLUMN reschedule_token VARCHAR(64)"))
            print(f"\n  added column {COLUMN}")
        if not has_idx:
            conn.execute(
                text(f"CREATE UNIQUE INDEX IF NOT EXISTS {INDEX_NAME} ON bookings ({COLUMN})")
            )
            print(f"  created {INDEX_NAME}")
        conn.commit()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
