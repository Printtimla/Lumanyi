-- Print Ops product shell (separate from Field Ops jobs)

CREATE TABLE print_jobs (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  title TEXT NOT NULL,
  product_type TEXT NOT NULL
    CHECK (product_type IN (
      'flyer', 'brochure', 'postcard', 'banner', 'business_card', 'menu', 'other'
    )),
  status TEXT NOT NULL DEFAULT 'intake'
    CHECK (status IN (
      'intake', 'proof', 'approved', 'in_production', 'ready', 'delivered', 'cancelled'
    )),
  quantity INTEGER,
  specs TEXT,
  due_date TEXT,
  estimate_cents INTEGER,
  notes TEXT,
  assigned_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_print_jobs_status ON print_jobs(status);
CREATE INDEX idx_print_jobs_customer ON print_jobs(customer_id);
CREATE INDEX idx_print_jobs_due ON print_jobs(due_date);
