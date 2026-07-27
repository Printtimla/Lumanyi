-- Print Ops depth: proof/delivery fields, files, quote lines

ALTER TABLE print_jobs ADD COLUMN proof_notes TEXT;
ALTER TABLE print_jobs ADD COLUMN delivery_method TEXT
  CHECK (delivery_method IS NULL OR delivery_method IN ('pickup', 'delivery'));
ALTER TABLE print_jobs ADD COLUMN delivery_notes TEXT;
ALTER TABLE print_jobs ADD COLUMN revise_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE print_files (
  id TEXT PRIMARY KEY,
  print_job_id TEXT NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'artwork'
    CHECK (kind IN ('artwork', 'proof', 'other')),
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE print_quote_lines (
  id TEXT PRIMARY KEY,
  print_job_id TEXT NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'ea',
  unit_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_print_files_job ON print_files(print_job_id);
CREATE INDEX idx_print_quote_lines_job ON print_quote_lines(print_job_id);
