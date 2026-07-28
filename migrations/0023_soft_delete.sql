-- Soft delete (archive). Rows stay for restore / audit; hidden from normal lists.

ALTER TABLE customers ADD COLUMN deleted_at TEXT;
ALTER TABLE jobs ADD COLUMN deleted_at TEXT;
ALTER TABLE print_jobs ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON customers(deleted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_deleted_at ON jobs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_print_jobs_deleted_at ON print_jobs(deleted_at);
