-- Custom section titles are optional (media-only sections have none).
-- PostgreSQL. Idempotent, deletes nothing. The backend also runs this at startup
-- (reconcile_database_schema); SQLite databases are rebuilt by the same startup step.
ALTER TABLE profile_sections ALTER COLUMN title DROP NOT NULL;
