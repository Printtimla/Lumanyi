-- Moisture readings + equipment placement logs for restoration jobs.

CREATE TABLE job_field_logs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('moisture', 'equipment')),
  logged_at TEXT NOT NULL,
  area TEXT,
  reading TEXT,
  equipment_type TEXT,
  equipment_count INTEGER,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_job_field_logs_job ON job_field_logs(job_id, logged_at DESC);
CREATE INDEX idx_job_field_logs_kind ON job_field_logs(job_id, kind);
