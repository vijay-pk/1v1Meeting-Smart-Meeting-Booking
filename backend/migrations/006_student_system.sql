-- Migration 006: student meeting system — new COLUMNS on existing tables.
--
-- New TABLES (student_allowances, allowance_adjustments, student_policy_acceptances,
-- meeting_recordings, report_deliveries, student_credential_emails) are created by
-- Base.metadata.create_all at startup — create_all adds whole tables but never a column on an
-- existing one, which is why only the columns below need this migration.
--
-- Postgres form (Supabase SQL editor). Additive, idempotent, nullable, deletes nothing.
-- For SQLite / mixed environments use scripts/apply_student_system_migration.py instead.

ALTER TABLE users    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS audience VARCHAR(20) DEFAULT 'public';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS category VARCHAR(20) DEFAULT 'client';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS student_id VARCHAR(36);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(20);
CREATE INDEX IF NOT EXISTS ix_bookings_student_id ON bookings (student_id);

-- Backfill existing rows to the non-null defaults (ADD COLUMN DEFAULT already does this on
-- Postgres, but make it explicit and safe to re-run).
UPDATE bookings SET category = 'client' WHERE category IS NULL;
UPDATE sessions SET audience = 'public' WHERE audience IS NULL;
UPDATE users    SET must_change_password = FALSE WHERE must_change_password IS NULL;
