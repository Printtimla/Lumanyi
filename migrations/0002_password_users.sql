-- Force password change + index for assignees

ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

UPDATE users SET must_change_password = 1 WHERE email = 'owner@lumanyi.local';

CREATE INDEX IF NOT EXISTS idx_jobs_assigned ON jobs(assigned_user_id);
