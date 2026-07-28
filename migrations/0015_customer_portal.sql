-- Customer portal: magic-link tokens + portal sessions (read-only).

CREATE TABLE portal_tokens (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  expires_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE INDEX idx_portal_tokens_customer ON portal_tokens(customer_id);
CREATE INDEX idx_portal_tokens_hash ON portal_tokens(token_hash);

CREATE TABLE portal_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL REFERENCES portal_tokens(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_portal_sessions_customer ON portal_sessions(customer_id);
