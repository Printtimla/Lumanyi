-- Recurring hard-floor (and other) job templates

CREATE TABLE recurring_jobs (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  site_id TEXT REFERENCES sites(id),
  title TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'hard_floor'
    CHECK (job_type IN ('restoration', 'hard_floor')),
  interval_days INTEGER NOT NULL CHECK (interval_days > 0),
  next_run_at TEXT NOT NULL,
  assigned_user_id TEXT REFERENCES users(id),
  estimate_cents INTEGER,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_recurring_next ON recurring_jobs(active, next_run_at);
CREATE INDEX idx_recurring_customer ON recurring_jobs(customer_id);
