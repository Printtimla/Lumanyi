-- Import floor process types (timlafloorrestoration.com) and print catalog
-- types (sacramentob2bprint.com / print-adrian services.yml).
-- SQLite cannot ALTER CHECK in place.

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
      'strip_wax',
      'floor_waxing',
      'scrub_recoat',
      'burnishing',
      'floor_sealing',
      'epoxy',
      'tile_grout',
      'concrete',
      'hardwood',
      'laminate',
      'vinyl_linoleum',
      'pet_odor_removal',
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

INSERT INTO jobs_new SELECT
  id, customer_id, site_id, title, job_type, status,
  scheduled_start, scheduled_end, assigned_user_id,
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
      'strip_wax',
      'floor_waxing',
      'scrub_recoat',
      'burnishing',
      'floor_sealing',
      'epoxy',
      'tile_grout',
      'concrete',
      'hardwood',
      'laminate',
      'vinyl_linoleum',
      'pet_odor_removal',
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

INSERT INTO recurring_jobs_new SELECT * FROM recurring_jobs;

DROP TABLE recurring_jobs;
ALTER TABLE recurring_jobs_new RENAME TO recurring_jobs;

CREATE INDEX idx_recurring_next ON recurring_jobs(active, next_run_at);
CREATE INDEX idx_recurring_customer ON recurring_jobs(customer_id);

CREATE TABLE print_jobs_new (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  title TEXT NOT NULL,
  product_type TEXT NOT NULL
    CHECK (product_type IN (
      'automated_paper_folding',
      'billing_invoices_compliance_mailing',
      'mass_direct_mail_postcards',
      'political_campaign_mailers',
      'print_and_fold_packages',
      'b2b_print_fulfillment',
      'bulk_document_printing',
      'wire_plastic_comb_bookbinding',
      'legal_discovery_printing',
      'business_reports',
      'manuals_training_kits',
      'bulk_scan_to_pdf',
      'brochure_printing',
      'flyer_printing',
      'architectural_blueprints',
      'die_cut_vinyl_decals',
      'commercial_signs_banners',
      'tripod_x_frame_banners',
      'window_graphics_privacy_frost',
      'wide_format_posters',
      'event_banners_backdrops',
      'rigid_signs_boards',
      'compliance_healthcare_lamination',
      'restaurant_menu_lamination',
      'lamination_wide_format_finishing',
      'custom_invitations_announcements',
      'branded_thank_you_cards',
      'presentation_portfolio_binding',
      'restaurant_menu_printing',
      'flyer',
      'brochure',
      'postcard',
      'banner',
      'business_card',
      'menu',
      'other'
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  proof_notes TEXT,
  delivery_method TEXT
    CHECK (delivery_method IS NULL OR delivery_method IN ('pickup', 'delivery')),
  delivery_notes TEXT,
  revise_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO print_jobs_new (
  id, customer_id, title, product_type, status, quantity, specs, due_date,
  estimate_cents, notes, assigned_user_id, created_at, updated_at,
  proof_notes, delivery_method, delivery_notes, revise_count
)
SELECT
  id, customer_id, title, product_type, status, quantity, specs, due_date,
  estimate_cents, notes, assigned_user_id, created_at, updated_at,
  proof_notes, delivery_method, delivery_notes, revise_count
FROM print_jobs;

DROP TABLE print_jobs;
ALTER TABLE print_jobs_new RENAME TO print_jobs;

CREATE INDEX idx_print_jobs_status ON print_jobs(status);
CREATE INDEX idx_print_jobs_customer ON print_jobs(customer_id);
CREATE INDEX idx_print_jobs_due ON print_jobs(due_date);

PRAGMA foreign_keys = ON;
