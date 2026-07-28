-- Expand user roles with lead_tech designation. SQLite cannot ALTER CHECK in place.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'dispatcher', 'lead_tech', 'tech')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  must_change_password INTEGER NOT NULL DEFAULT 0
);

INSERT INTO users_new (id, email, name, password_hash, role, created_at, must_change_password)
SELECT id, email, name, password_hash, role, created_at, must_change_password
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_jobs_assigned ON jobs(assigned_user_id);

PRAGMA foreign_keys = ON;
