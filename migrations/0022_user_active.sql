-- Soft offboarding: deactivated users cannot log in; history stays attached.
ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
