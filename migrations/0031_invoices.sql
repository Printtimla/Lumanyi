-- MG-3.1: Invoices (field + print) with draft → approved → sent.
-- No SQL FOREIGN KEYs: D1 has rejected FK creates on some accounts (SQLITE_CONSTRAINT_FOREIGNKEY).
-- Integrity is enforced in app code (job/print job load + cascade deletes via app).

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('field', 'print')),
  job_id TEXT,
  print_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'sent')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  writeoff_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  sent_by TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (source = 'field' AND job_id IS NOT NULL AND print_job_id IS NULL)
    OR (source = 'print' AND print_job_id IS NOT NULL AND job_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'ea',
  unit_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_print_job ON invoices(print_job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);

PRAGMA foreign_keys = ON;
