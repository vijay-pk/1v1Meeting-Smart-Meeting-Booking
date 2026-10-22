"""
Applies migration 006 -- student-system COLUMNS on users/sessions/bookings.

    cd backend
    python scripts/apply_student_system_migration.py            # apply
    python scripts/apply_student_system_migration.py --check    # report only

Idempotent on PostgreSQL and SQLite, additive, deletes nothing. The new student TABLES are
created by create_all at startup; only the columns below need this script. On Supabase prod the
equivalent is migrations/006_student_system.sql run in the SQL editor.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.core.database import engine  # noqa: E402

# (table, column, column DDL type) -- each added only if missing.
COLUMNS = [
    ("users", "must_change_password", "BOOLEAN DEFAULT FALSE"),
    ("sessions", "audience", "VARCHAR(20) DEFAULT 'public'"),
    ("bookings", "category", "VARCHAR(20) DEFAULT 'client'"),
    ("bookings", "student_id", "VARCHAR(36)"),
    ("bookings", "attendance_status", "VARCHAR(20)"),
]
INDEX = ("ix_bookings_student_id", "bookings", "student_id")


def existing_columns(conn, table):
    return {c["name"] for c in inspect(conn).get_columns(table)}


def existing_indexes(conn, table):
    return {ix["name"] for ix in inspect(conn).get_indexes(table)}


def main() -> int:
    check_only = "--check" in sys.argv

    with engine.connect() as conn:
        tables = set(inspect(conn).get_table_names())
        print(f"  database : {engine.url.get_backend_name()}")

        todo = []
        for table, column, ddl in COLUMNS:
            if table not in tables:
                print(f"  {table}.{column} : table absent (create_all not run yet) -- skip")
                continue
            present = column in existing_columns(conn, table)
            print(f"  {table}.{column} : {'present' if present else 'MISSING'}")
            if not present:
                todo.append(("col", table, column, ddl))

        idx_name, idx_table, idx_col = INDEX
        idx_present = idx_table in tables and idx_name in existing_indexes(conn, idx_table)
        print(f"  index {idx_name} : {'present' if idx_present else 'MISSING'}")
        if idx_table in tables and not idx_present:
            todo.append(("idx", idx_table, idx_name, idx_col))

        if not todo:
            print("\n  Nothing to do.")
            return 0
        if check_only:
            print("\n  --check: no changes made. Re-run without --check to apply.")
            return 0

        for kind, table, name, extra in todo:
            if kind == "col":
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {extra}"))
                print(f"  added column {table}.{name}")
            else:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({extra})"))
                print(f"  created index {name}")
        conn.commit()
        print("\n  Done.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
