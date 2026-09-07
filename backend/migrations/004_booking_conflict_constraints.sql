-- 004: the double-booking constraint.
--
-- Every conflict check in payments.py is a SELECT followed by an INSERT with no locking and
-- no isolation control, so two requests can both read "no conflict" before either commits.
-- The window is the length of a Razorpay checkout -- minutes. No amount of application code
-- closes it; only the database can settle the race.
--
-- Partial, so a slot frees up again once a booking is cancelled or completed. admin_id is
-- nullable (permanently deleted admins are detached from their bookings) and NULLs compare
-- as distinct in both PostgreSQL and SQLite, so anonymized rows never collide.
--
-- Deliberately NOT indexing slot_locks(admin_id, start_time): expired locks keep
-- status='active' forever because nothing sweeps them, so a unique index there would let a
-- ten-minute-old abandoned hold block that slot permanently. Lock expiry is handled in
-- bookings.py instead, and bookings is the table that actually decides what is booked.
--
-- Apply with:  python scripts/apply_booking_constraints_migration.py
-- Idempotent, additive, and deletes nothing. Both PostgreSQL and SQLite (>= 3.8.0) support
-- partial unique indexes with this exact syntax.

CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_admin_slot_active
    ON bookings (admin_id, start_time)
    WHERE status IN ('confirmed', 'pending_payment');
