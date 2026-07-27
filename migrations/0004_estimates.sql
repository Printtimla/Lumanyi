-- Claim fields + internal estimate rooms/lines (not Xactimate)

ALTER TABLE jobs ADD COLUMN claim_number TEXT;
ALTER TABLE jobs ADD COLUMN carrier TEXT;
ALTER TABLE jobs ADD COLUMN date_of_loss TEXT;

CREATE TABLE estimate_rooms (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  length_ft REAL,
  width_ft REAL,
  height_ft REAL,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE estimate_lines (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  room_id TEXT REFERENCES estimate_rooms(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'ea',
  unit_cents INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_estimate_rooms_job ON estimate_rooms(job_id);
CREATE INDEX idx_estimate_lines_job ON estimate_lines(job_id);
CREATE INDEX idx_estimate_lines_room ON estimate_lines(room_id);
