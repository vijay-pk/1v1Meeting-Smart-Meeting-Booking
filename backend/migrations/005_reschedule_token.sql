-- Migration 005: add bookings.reschedule_token
--
-- Rescheduling is now a first-class FastAPI flow (GET/POST /api/bookings/reschedule/{token}).
-- The token is how the reschedule link resolves a booking without a login. create_all only
-- adds whole tables, never a column on an existing one, so production (built by create_all)
-- needs this applied by hand via scripts/apply_reschedule_token_migration.py.
--
-- Additive, idempotent, deletes nothing. Column is nullable: existing rows keep NULL, new
-- bookings populate it at create-order time.

ALTER TABLE bookings ADD COLUMN reschedule_token VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_reschedule_token ON bookings (reschedule_token);
