-- Migration 002 — "Import from SuperProfile" staging table (PostgreSQL / Supabase).
--
-- This is a new TABLE, so `Base.metadata.create_all` creates it by itself on the next boot.
-- The file exists so a DBA applying migrations by hand ends up with the same schema, and so
-- the table's shape is reviewable outside the ORM.
--
-- Run with:  psql "$DATABASE_URL" -f backend/migrations/002_profile_imports.sql
-- Safe to run more than once.

BEGIN;

-- One row per import attempt. Parsing writes only here; the admin's real profile and session
-- rows are touched only after they confirm the preview. `parsed_data` holds sanitized plain
-- text — no HTML, and never any credential from the source page.
CREATE TABLE IF NOT EXISTS profile_imports (
    id          VARCHAR(36)  PRIMARY KEY,
    admin_id    VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_url  VARCHAR(1000) NOT NULL,
    source_type VARCHAR(30)  NOT NULL DEFAULT 'superprofile',
    status      VARCHAR(20)  NOT NULL DEFAULT 'preview',   -- preview | applied | cancelled
    parsed_data JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMP,
    updated_at  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_profile_imports_admin_id ON profile_imports (admin_id);

COMMIT;
