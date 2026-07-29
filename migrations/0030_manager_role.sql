-- MG-0: real manager permission role on users.role.
-- SQLite cannot ALTER CHECK in place; recreate users (same pattern as 0010).
-- Existing Management designations currently stored as role=dispatcher.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'dispatcher', 'tech')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  designation TEXT,
  products TEXT NOT NULL DEFAULT 'restoration,floors,print',
  active INTEGER NOT NULL DEFAULT 1
);

INSERT INTO users_new (
  id, email, name, password_hash, role, created_at,
  must_change_password, designation, products, active
)
SELECT
  id,
  email,
  name,
  password_hash,
  CASE
    WHEN COALESCE(designation, role) = 'manager' THEN 'manager'
    WHEN role IN ('owner', 'manager', 'dispatcher', 'tech') THEN role
    ELSE 'tech'
  END,
  created_at,
  COALESCE(must_change_password, 0),
  designation,
  COALESCE(products, 'restoration,floors,print'),
  COALESCE(active, 1)
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

PRAGMA foreign_keys = ON;
