-- Migration 005 — Drop profile_imports table (SuperProfile feature removed).
--
-- Removes the profile_imports table, which was used for importing profiles from SuperProfile.bio.
-- The feature is no longer supported; the table can be safely dropped.
--
-- Run with:  psql "$DATABASE_URL" -f backend/migrations/005_drop_profile_imports.sql
-- Safe to run more than once.

BEGIN;

DROP TABLE IF EXISTS profile_imports CASCADE;

COMMIT;
