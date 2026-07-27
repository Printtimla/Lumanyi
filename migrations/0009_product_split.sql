-- Split Field Ops into Restoration & Remediation vs Hard Floor products.
-- Expand IICRC-aligned service types. SQLite cannot ALTER CHECK in place.

PRAGMA foreign_keys = OFF;

CREATE TABLE jobs_new (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  site_id TEXT REFERENCES sites(id),
  title TEXT NOT NULL,
  job_type TEXT NOT NULL
    CHECK (job_type IN (
      'water_restoration',
      'structural_drying',
      'microbial_remediation',
      'biohazard',
      'odor_removal',
      'hard_floor',
      'restoration'
    )),
  status TEXT NOT NULL DEFAULT 'lead'
    CHECK (status IN ('lead', 'estimate', 'scheduled', 'in_progress', 'complete', 'invoiced', 'cancelled')),
  scheduled_start TEXT,
  scheduled_end TEXT,
  assigned_user_id TEXT REFERENCES users(id),
  estimate_cents INTEGER,
  invoice_cents INTEGER,
  notes TEXT,
  claim_number TEXT,
  carrier TEXT,
  date_of_loss TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO jobs_new (
  id, customer_id, site_id, title, job_type, status,
  scheduled_start, scheduled_end, assigned_user_id,
  estimate_cents, invoice_cents, notes,
  claim_number, carrier, date_of_loss,
  created_at, updated_at
)
SELECT
  id, customer_id, site_id, title,
  CASE WHEN job_type = 'restoration' THEN 'water_restoration' ELSE job_type END,
  status, scheduled_start, scheduled_end, assigned_user_id,
  estimate_cents, invoice_cents, notes,
  claim_number, carrier, date_of_loss,
  created_at, updated_at
FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_scheduled ON jobs(scheduled_start);
CREATE INDEX idx_jobs_customer ON jobs(customer_id);
CREATE INDEX idx_jobs_assigned ON jobs(assigned_user_id);
CREATE INDEX idx_jobs_type ON jobs(job_type);

CREATE TABLE recurring_jobs_new (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  site_id TEXT REFERENCES sites(id),
  title TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'hard_floor'
    CHECK (job_type IN (
      'water_restoration',
      'structural_drying',
      'microbial_remediation',
      'biohazard',
      'odor_removal',
      'hard_floor',
      'restoration'
    )),
  interval_days INTEGER NOT NULL CHECK (interval_days > 0),
  next_run_at TEXT NOT NULL,
  assigned_user_id TEXT REFERENCES users(id),
  estimate_cents INTEGER,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO recurring_jobs_new
SELECT
  id, customer_id, site_id, title,
  CASE WHEN job_type = 'restoration' THEN 'water_restoration' ELSE job_type END,
  interval_days, next_run_at, assigned_user_id, estimate_cents, notes, active, created_at
FROM recurring_jobs;

DROP TABLE recurring_jobs;
ALTER TABLE recurring_jobs_new RENAME TO recurring_jobs;

CREATE INDEX idx_recurring_next ON recurring_jobs(active, next_run_at);
CREATE INDEX idx_recurring_customer ON recurring_jobs(customer_id);

PRAGMA foreign_keys = ON;
