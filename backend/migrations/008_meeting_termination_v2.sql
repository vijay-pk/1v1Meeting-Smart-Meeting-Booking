-- Migration 008: durable Meet termination job (scheduled end + 3 minutes).
-- Run in the Supabase SQL editor. Idempotent. The backend also adds these columns at startup
-- (reconcile_database_schema), so this is the manual/explicit path. Deletes nothing.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS termination_due_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS termination_next_attempt_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS termination_claimed_at TIMESTAMP;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS termination_generation INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS termination_last_http_status INTEGER;

CREATE INDEX IF NOT EXISTS ix_bookings_termination_due_at ON bookings (termination_due_at);

-- Backfill: every still-open job gets its deadline = scheduled end (Asia/Kolkata wall clock
-- stored with a cosmetic trailing Z) converted to UTC, + 3 minutes.
UPDATE bookings
SET termination_due_at =
      (to_timestamp(replace(end_time, 'Z', ''), 'YYYY-MM-DD"T"HH24:MI:SS') AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC')
      + INTERVAL '3 minutes'
WHERE termination_due_at IS NULL
  AND status = 'confirmed'
  AND google_meet_link IS NOT NULL
  AND termination_status IN ('pending', 'retry');

-- meeting_termination_attempts is a new table; the backend creates it at startup via create_all.
-- Explicit form, if you prefer to create it by hand:
CREATE TABLE IF NOT EXISTS meeting_termination_attempts (
    id VARCHAR(36) PRIMARY KEY,
    booking_id VARCHAR(36) NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL DEFAULT 0,
    outcome VARCHAR(30) NOT NULL,
    http_status INTEGER,
    detail TEXT,
    created_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_meeting_termination_attempts_booking_id ON meeting_termination_attempts (booking_id);
