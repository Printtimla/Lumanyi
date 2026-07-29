-- MG-3.1: Invoices (field + print) with draft → approved → sent.

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('field', 'print')),
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  print_job_id TEXT REFERENCES print_jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  writeoff_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  sent_by TEXT REFERENCES users(id),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (source = 'field' AND job_id IS NOT NULL AND print_job_id IS NULL)
    OR (source = 'print' AND print_job_id IS NOT NULL AND job_id IS NULL)
  )
);

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'ea',
  unit_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_invoices_job ON invoices(job_id);
CREATE INDEX idx_invoices_print_job ON invoices(print_job_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoice_lines_invoice ON invoice_lines(invoice_id);
