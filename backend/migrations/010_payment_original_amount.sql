-- Migration 010: snapshot of the Real Price on a payment when an Offer Price was in force.
-- Idempotent; deletes nothing; existing rows stay NULL (no offer). The backend also adds the
-- column at startup (reconcile_database_schema).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS original_amount INTEGER;
