-- Lead pipeline fields on field jobs (restoration + floors).

ALTER TABLE jobs ADD COLUMN lead_source TEXT;
ALTER TABLE jobs ADD COLUMN follow_up_at TEXT;

CREATE INDEX idx_jobs_follow_up ON jobs(follow_up_at);
CREATE INDEX idx_jobs_lead_status ON jobs(status);
