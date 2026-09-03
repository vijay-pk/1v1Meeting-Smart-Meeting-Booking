"""
Applies migration 001 to the database named by DATABASE_URL.

The project has no migration framework: schema comes from Base.metadata.create_all, which
only ever adds missing tables. This script covers the part that cannot do -- relaxing three
NOT NULL constraints so a permanently deleted admin can be detached from the bookings and
payments that outlive them.

    cd backend
    python scripts/apply_migration.py            # apply
    python scripts/apply_migration.py --check    # report only, change nothing

Idempotent on both PostgreSQL and SQLite. SQLite cannot ALTER a column, so there the table
is rebuilt with the relaxed constraints and its rows copied across, inside one transaction.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.core.database import engine, Base  # noqa: E402
from app.models.models import DeletedAdminIdentity  # noqa: F401,E402  (registers the table)

NULLABLE_TARGETS = [
    ("bookings", "admin_id"),
    ("bookings", "meeting_type_id"),
    ("payments", "admin_id"),
]


def current_state(inspector):
    state = {}
    tables = set(inspector.get_table_names())
    state["deleted_admin_identities"] = "deleted_admin_identities" in tables
    for table, column in NULLABLE_TARGETS:
        if table not in tables:
            state[(table, column)] = None  # table absent
            continue
        col = next((c for c in inspector.get_columns(table) if c["name"] == column), None)
        state[(table, column)] = None if col is None else col["nullable"]
    return state


def report(state):
    print(f"  deleted_admin_identities table : {'present' if state['deleted_admin_identities'] else 'MISSING'}")
    for table, column in NULLABLE_TARGETS:
        value = state[(table, column)]
        if value is None:
            print(f"  {table}.{column:16} : table/column absent (nothing to do)")
        else:
            print(f"  {table}.{column:16} : {'nullable' if value else 'NOT NULL (needs migration)'}")


def migrate_postgres(conn):
    for table, column in NULLABLE_TARGETS:
        conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL"))
        print(f"  relaxed {table}.{column}")


def migrate_sqlite(conn):
    """
    SQLite has no ALTER COLUMN. Rebuild each affected table with the relaxed definition and
    copy the rows over. legacy_alter_table keeps the copy from rewriting other tables'
    references while this runs.
    """
    rebuilds = {
        "bookings": """
            CREATE TABLE bookings_migrated (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                public_id VARCHAR(50) NOT NULL UNIQUE,
                admin_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
                meeting_type_id VARCHAR(36) REFERENCES sessions(id) ON DELETE SET NULL,
                client_name VARCHAR(100) NOT NULL,
                client_email VARCHAR(150) NOT NULL,
                client_phone VARCHAR(30),
                start_time VARCHAR(30) NOT NULL,
                end_time VARCHAR(30) NOT NULL,
                timezone VARCHAR(50) NOT NULL,
                status VARCHAR(30) NOT NULL,
                payment_status VARCHAR(30) NOT NULL,
                google_event_id VARCHAR(255),
                google_meet_link VARCHAR(255),
                cancellation_token VARCHAR(64) NOT NULL UNIQUE,
                notes TEXT,
                created_at DATETIME,
                updated_at DATETIME
            )
        """,
        "payments": """
            CREATE TABLE payments_migrated (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                booking_id VARCHAR(36) NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
                admin_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
                provider VARCHAR(30) NOT NULL,
                order_id VARCHAR(100) NOT NULL,
                payment_id VARCHAR(100),
                amount INTEGER NOT NULL,
                currency VARCHAR(10) NOT NULL,
                status VARCHAR(30) NOT NULL,
                created_at DATETIME
            )
        """,
    }

    inspector = inspect(conn)
    existing = set(inspector.get_table_names())

    for table, create_sql in rebuilds.items():
        if table not in existing:
            print(f"  {table}: absent, skipped")
            continue
        columns = [c["name"] for c in inspector.get_columns(table)]
        col_list = ", ".join(columns)
        conn.execute(text(f"DROP TABLE IF EXISTS {table}_migrated"))
        conn.execute(text(create_sql))
        conn.execute(text(f"INSERT INTO {table}_migrated ({col_list}) SELECT {col_list} FROM {table}"))
        conn.execute(text(f"DROP TABLE {table}"))
        conn.execute(text(f"ALTER TABLE {table}_migrated RENAME TO {table}"))
        print(f"  rebuilt {table} with nullable admin/meeting references")

    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_bookings_admin_id ON bookings (admin_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_payments_order_id ON payments (order_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_payments_payment_id ON payments (payment_id)"))


def main() -> int:
    check_only = "--check" in sys.argv
    dialect = engine.dialect.name
    print(f"Database: {engine.url.render_as_string(hide_password=True)}  (dialect: {dialect})")

    print("\nBefore:")
    before = current_state(inspect(engine))
    report(before)

    needs_columns = any(before[key] is False for key in [(t, c) for t, c in NULLABLE_TARGETS])
    needs_table = not before["deleted_admin_identities"]

    if check_only:
        print("\n--check: no changes made.")
        return 0

    if not needs_table and not needs_columns:
        print("\nAlready migrated; nothing to do.")
        return 0

    print("\nApplying:")
    if needs_table:
        Base.metadata.create_all(bind=engine, tables=[DeletedAdminIdentity.__table__])
        print("  created deleted_admin_identities")

    if needs_columns:
        with engine.begin() as conn:
            if dialect == "sqlite":
                conn.execute(text("PRAGMA legacy_alter_table = ON"))
                migrate_sqlite(conn)
            else:
                migrate_postgres(conn)

    print("\nAfter:")
    report(current_state(inspect(engine)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
