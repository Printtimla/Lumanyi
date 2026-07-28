-- Expand user roles with lead_tech.
-- Rename + recreate (do not DROP users while FKs point at it — fails on D1 remote).

ALTER TABLE users RENAME TO users_old;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'dispatcher', 'lead_tech', 'tech')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  must_change_password INTEGER NOT NULL DEFAULT 0
);

INSERT INTO users (id, email, name, password_hash, role, created_at, must_change_password)
SELECT id, email, name, password_hash, role, created_at, must_change_password
FROM users_old;

DROP TABLE users_old;
