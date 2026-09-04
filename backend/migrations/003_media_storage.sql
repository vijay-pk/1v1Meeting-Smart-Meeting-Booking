-- Migration 003 — profile media in Supabase Storage (PostgreSQL / Supabase).
--
-- `media_assets` is created by `Base.metadata.create_all` on first boot, but create_all only
-- ever ADDS tables: the columns below are added to an existing table, so this file has to be
-- applied by hand on any database that already has the table.
--
-- What changes: the row stops being the container for the image bytes and becomes the
-- reference to an object in the `profile-media` bucket. `data` is kept, and made nullable, so
-- rows written by the previous bytes-in-Postgres implementation keep serving; nothing new
-- writes to it.
--
-- Run with:  psql "$DATABASE_URL" -f backend/migrations/003_media_storage.sql
-- Or:        python scripts/apply_migration.py            (from backend/)
-- Safe to run more than once. Deletes nothing.

BEGIN;

-- The table itself, for a database that has never booted the new code.
CREATE TABLE IF NOT EXISTS media_assets (
    id            VARCHAR(36)  PRIMARY KEY,
    owner_id      VARCHAR(36)  REFERENCES users(id) ON DELETE CASCADE,
    filename      VARCHAR(255) NOT NULL,
    content_type  VARCHAR(100) NOT NULL,
    byte_size     INTEGER      NOT NULL,
    created_at    TIMESTAMP    DEFAULT NOW()
);

-- Where the object actually lives.
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(30) NOT NULL DEFAULT 'supabase';
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS storage_path     VARCHAR(500);
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS public_url       TEXT;

-- Legacy bytes column: present for old rows, nullable, never written to again.
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS data BYTEA;
ALTER TABLE media_assets ALTER COLUMN data DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_owner ON media_assets(owner_id);

COMMIT;

-- ---------------------------------------------------------------------------------------
-- Supabase Storage, which is NOT created by this file
-- ---------------------------------------------------------------------------------------
--
-- The application creates the bucket itself on the first upload (`ensure_bucket()` in
-- app/services/supabase_storage.py), provided SUPABASE_SERVICE_ROLE_KEY is a valid service
-- role key. If you would rather create it by hand, in the Supabase dashboard:
--
--   Storage -> New bucket
--     Name:              profile-media
--     Public bucket:     yes
--     File size limit:   8 MB
--     Allowed MIME types: image/jpeg, image/png, image/webp, image/gif, image/avif
--
-- Public is deliberate: these are profile photos on a booking page that anyone holding the
-- host's link can open, so a stable public URL is simpler and cheaper than minting signed
-- URLs per view. Only this bucket is public. No other bucket, table or credential is exposed
-- by it, and nothing private is ever written into it.
--
-- No storage RLS policy is needed for reads from a public bucket. Writes go through the
-- FastAPI upload endpoint using the service role key, which stays on the server.
