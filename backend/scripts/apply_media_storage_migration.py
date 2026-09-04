"""
Applies migration 003 to the database named by DATABASE_URL.

`media_assets` moves from holding image bytes to holding a reference to an object in Supabase
Storage. That means three new columns, and relaxing NOT NULL on `data` so rows written by the
previous implementation can stay while nothing new writes bytes. `Base.metadata.create_all`
only ever adds whole tables, so neither part happens by itself.

    cd backend
    python scripts/apply_media_storage_migration.py            # apply
    python scripts/apply_media_storage_migration.py --check    # report only, change nothing

Idempotent on both PostgreSQL and SQLite. Deletes nothing: on SQLite, where a column cannot be
altered, the table is rebuilt with the relaxed constraint and every existing row is copied
across inside one transaction.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text  # noqa: E402

from app.core.database import engine, Base  # noqa: E402
from app.models.models import MediaAsset  # noqa: F401,E402  (registers the table)

NEW_COLUMNS = {
    "storage_provider": "VARCHAR(30)",
    "storage_path": "VARCHAR(500)",
    "public_url": "TEXT",
}


def describe(inspector):
    if "media_assets" not in inspector.get_table_names():
        return None
    return {c["name"]: c for c in inspector.get_columns("media_assets")}


def report(columns):
    if columns is None:
        print("media_assets: absent (create_all will create it complete on next boot)")
        return
    for name in NEW_COLUMNS:
        print(f"  {name}: {'present' if name in columns else 'MISSING'}")
    data = columns.get("data")
    if data is None:
        print("  data: absent (fine — nothing new writes bytes)")
    else:
        print(f"  data nullable: {data['nullable']}" + ("" if data["nullable"] else "  <- needs relaxing"))


def main():
    check_only = "--check" in sys.argv
    dialect = engine.dialect.name
    print(f"Database: {dialect}")

    Base.metadata.create_all(bind=engine)          # creates the table if it is missing entirely

    inspector = inspect(engine)
    columns = describe(inspector)
    print("Before:")
    report(columns)

    if columns is None:
        print("\nNothing to migrate: the table was just created with the current shape.")
        return

    missing = [name for name in NEW_COLUMNS if name not in columns]
    data_column = columns.get("data")
    needs_null_relax = data_column is not None and not data_column["nullable"]

    if not missing and not needs_null_relax:
        print("\nAlready up to date.")
        return

    if check_only:
        print("\n--check: nothing was changed.")
        return

    with engine.begin() as conn:
        for name in missing:
            conn.execute(text(f"ALTER TABLE media_assets ADD COLUMN {name} {NEW_COLUMNS[name]}"))
            print(f"  added {name}")
        if missing and "storage_provider" in missing:
            conn.execute(text("UPDATE media_assets SET storage_provider = 'database' WHERE storage_provider IS NULL"))

        if needs_null_relax:
            if dialect == "postgresql":
                conn.execute(text("ALTER TABLE media_assets ALTER COLUMN data DROP NOT NULL"))
                print("  relaxed NOT NULL on data")
            else:
                # SQLite cannot alter a column, so the table is rebuilt and the rows copied.
                conn.execute(text("ALTER TABLE media_assets RENAME TO media_assets_old"))
                conn.execute(text("""
                    CREATE TABLE media_assets (
                        id               VARCHAR(36)  NOT NULL PRIMARY KEY,
                        owner_id         VARCHAR(36),
                        filename         VARCHAR(255) NOT NULL,
                        content_type     VARCHAR(100) NOT NULL,
                        byte_size        INTEGER      NOT NULL,
                        storage_provider VARCHAR(30),
                        storage_path     VARCHAR(500),
                        public_url       TEXT,
                        data             BLOB,
                        created_at       DATETIME,
                        FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
                    )
                """))
                conn.execute(text("""
                    INSERT INTO media_assets
                        (id, owner_id, filename, content_type, byte_size,
                         storage_provider, storage_path, public_url, data, created_at)
                    SELECT id, owner_id, filename, content_type, byte_size,
                           COALESCE(storage_provider, 'database'), storage_path, public_url, data, created_at
                    FROM media_assets_old
                """))
                conn.execute(text("DROP TABLE media_assets_old"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_media_assets_owner ON media_assets(owner_id)"))
                print("  rebuilt the table with a nullable data column (rows copied)")

    print("\nAfter:")
    report(describe(inspect(engine)))


if __name__ == "__main__":
    main()
