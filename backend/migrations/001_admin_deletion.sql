-- Migration 001 — permanent admin deletion support (PostgreSQL / Supabase).
--
-- The application creates missing TABLES on boot (Base.metadata.create_all), but it never
-- alters an existing one. `deleted_admin_identities` therefore appears by itself on a
-- fresh start; the three column changes below do not, and must be applied by hand to any
-- database that already holds a `bookings` or `payments` table.
--
-- Run with:  psql "$DATABASE_URL" -f backend/migrations/001_admin_deletion.sql
-- or:        python backend/scripts/apply_migration.py
--
-- Safe to run more than once.

BEGIN;

-- 1. Tombstone table. Not an account: a keyed hash of a deleted admin's email plus the
--    username they freed, so neither can be reused. See models.DeletedAdminIdentity.
CREATE TABLE IF NOT EXISTS deleted_admin_identities (
    id          VARCHAR(36) PRIMARY KEY,
    email_hash  VARCHAR(64) NOT NULL,
    username    VARCHAR(50),
    deleted_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
    deleted_by  VARCHAR(36),
    reason      VARCHAR(255)
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_deleted_admin_identities_email_hash
    ON deleted_admin_identities (email_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ix_deleted_admin_identities_username
    ON deleted_admin_identities (username);

-- 2. Let an admin be erased while the financial record survives. Deletion anonymizes the
--    booking and detaches it; without these the delete would either fail on a NOT NULL
--    violation or leave a foreign key pointing at a row that no longer exists.
ALTER TABLE bookings  ALTER COLUMN admin_id        DROP NOT NULL;
ALTER TABLE bookings  ALTER COLUMN meeting_type_id DROP NOT NULL;
ALTER TABLE payments  ALTER COLUMN admin_id        DROP NOT NULL;

COMMIT;
