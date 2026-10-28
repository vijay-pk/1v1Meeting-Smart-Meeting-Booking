-- Migration 009: persisted "session time is over" marker and a stored recording ETA.
-- Run in the Supabase SQL editor. Idempotent; deletes nothing. The backend also adds both
-- columns at startup (reconcile_database_schema), so this is the explicit/manual path.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE meeting_recordings ADD COLUMN IF NOT EXISTS estimated_ready_at TIMESTAMP;

-- Backfill: confirmed bookings whose scheduled end is already in the past.
UPDATE bookings
SET completed_at = (to_timestamp(replace(end_time, 'Z', ''), 'YYYY-MM-DD"T"HH24:MI:SS') AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC')
WHERE completed_at IS NULL
  AND status = 'confirmed'
  AND (to_timestamp(replace(end_time, 'Z', ''), 'YYYY-MM-DD"T"HH24:MI:SS') AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC') < (now() AT TIME ZONE 'UTC');
