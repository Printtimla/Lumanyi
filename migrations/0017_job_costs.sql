-- Job cost lines (labor / materials / equipment / other) vs estimate.

CREATE TABLE job_cost_lines (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  category TEXT NOT NULL
    CHECK (category IN ('labor', 'materials', 'equipment', 'other')),
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'ea',
  unit_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_job_cost_lines_job ON job_cost_lines(job_id);
CREATE INDEX idx_job_cost_lines_category ON job_cost_lines(job_id, category);
