-- SA-6.3: Internal labor rates by designation (margin math — not payroll).

CREATE TABLE labor_rates (
  designation TEXT PRIMARY KEY,
  hourly_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id)
);

-- Seed rows for current designations at $0 (Owner sets real rates).
INSERT INTO labor_rates (designation, hourly_cents, active) VALUES
  ('owner', 0, 1),
  ('manager', 0, 1),
  ('dispatcher', 0, 1),
  ('mitigation_lead_tech', 0, 1),
  ('mitigation_tech', 0, 1),
  ('floor_lead_tech', 0, 1),
  ('floor_tech', 0, 1),
  ('print_tech', 0, 1);
