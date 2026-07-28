-- Product scopes for users (comma-separated: restoration,floors,print).
-- Existing users keep full access by default.

ALTER TABLE users ADD COLUMN products TEXT NOT NULL DEFAULT 'restoration,floors,print';
