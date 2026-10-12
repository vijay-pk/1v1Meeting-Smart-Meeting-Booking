-- 006: Google Meet strict meeting-time enforcement columns on bookings.
--
-- Adds fields to persist the Google Meet space identifier, termination lifecycle status,
-- diagnostic error message, actual termination timestamp, and retry counter.
--
-- Fully idempotent and additive. Works seamlessly with PostgreSQL and SQLite.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS google_meet_space_id VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS termination_status VARCHAR(30) DEFAULT 'pending';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS termination_error TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS termination_retries INTEGER DEFAULT 0;
