-- SA-6.1: Owner price lists / rate matrices (mitigation + floors).

CREATE TABLE price_list_items (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL CHECK (product IN ('restoration', 'floors')),
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('labor', 'materials', 'equipment', 'other')),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'ea',
  unit_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_price_list_product ON price_list_items(product, active, sort_order);
CREATE INDEX idx_price_list_name ON price_list_items(name);
