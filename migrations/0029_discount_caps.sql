-- SA-6.4: Owner write-off / discount caps (rules only; enforce when discount UI exists).

CREATE TABLE discount_cap_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  max_discount_pct REAL NOT NULL DEFAULT 0,
  max_writeoff_cents INTEGER NOT NULL DEFAULT 0,
  owner_approval_pct REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id)
);

INSERT INTO discount_cap_settings (
  id, max_discount_pct, max_writeoff_cents, owner_approval_pct
) VALUES ('default', 0, 0, 0);
