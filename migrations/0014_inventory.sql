-- Simple equipment inventory: assets + job assignments.

CREATE TABLE equipment_assets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  equipment_type TEXT NOT NULL,
  serial TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'on_job', 'maintenance', 'retired')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_equipment_assets_status ON equipment_assets(status);
CREATE INDEX idx_equipment_assets_type ON equipment_assets(equipment_type);

CREATE TABLE job_equipment (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES equipment_assets(id),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  returned_at TEXT,
  notes TEXT
);

CREATE INDEX idx_job_equipment_job ON job_equipment(job_id);
CREATE INDEX idx_job_equipment_asset ON job_equipment(asset_id);
CREATE INDEX idx_job_equipment_open ON job_equipment(asset_id, returned_at);
