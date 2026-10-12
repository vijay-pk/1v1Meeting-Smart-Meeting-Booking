-- Migration 007: Add grace_notified_at column for 2-minute Google Meet grace period enforcement
-- Authoritative reference: scheduled end time.
-- A notification is recorded at the scheduled end time, giving participants 2 minutes to wrap up,
-- after which automatic conference termination executes at end_time + 2 minutes.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS grace_notified_at TIMESTAMP;
