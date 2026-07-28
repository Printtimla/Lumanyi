-- SA-3: Void claim-critical field data (do not erase rows or R2 objects).

ALTER TABLE job_field_logs ADD COLUMN voided_at TEXT;
ALTER TABLE job_field_logs ADD COLUMN voided_by TEXT REFERENCES users(id);
ALTER TABLE job_field_logs ADD COLUMN void_reason TEXT;

ALTER TABLE job_photos ADD COLUMN voided_at TEXT;
ALTER TABLE job_photos ADD COLUMN voided_by TEXT REFERENCES users(id);
ALTER TABLE job_photos ADD COLUMN void_reason TEXT;

ALTER TABLE job_moisture_maps ADD COLUMN voided_at TEXT;
ALTER TABLE job_moisture_maps ADD COLUMN voided_by TEXT REFERENCES users(id);
ALTER TABLE job_moisture_maps ADD COLUMN void_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_job_field_logs_voided ON job_field_logs(job_id, voided_at);
CREATE INDEX IF NOT EXISTS idx_job_photos_voided ON job_photos(job_id, voided_at);
CREATE INDEX IF NOT EXISTS idx_job_moisture_maps_voided ON job_moisture_maps(job_id, voided_at);
