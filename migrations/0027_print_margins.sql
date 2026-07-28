-- SA-6.2: Owner print margin rules + optional cost on quote lines.

CREATE TABLE print_margin_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  cost_plus_pct REAL NOT NULL DEFAULT 0,
  material_markup_pct REAL NOT NULL DEFAULT 0,
  setup_fee_cents INTEGER NOT NULL DEFAULT 0,
  volume_tiers_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT REFERENCES users(id)
);

INSERT INTO print_margin_settings (id, cost_plus_pct, material_markup_pct, setup_fee_cents, volume_tiers_json)
VALUES ('default', 0, 0, 0, '[]');

ALTER TABLE print_quote_lines ADD COLUMN cost_unit_cents INTEGER;
