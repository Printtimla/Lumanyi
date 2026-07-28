-- Expand user roles with lead_tech.
-- D1 keeps FKs enforced; detach references before recreating users.

CREATE TABLE _mig12_job_assign AS
  SELECT id, assigned_user_id AS uid FROM jobs WHERE assigned_user_id IS NOT NULL;
CREATE TABLE _mig12_rec_assign AS
  SELECT id, assigned_user_id AS uid FROM recurring_jobs WHERE assigned_user_id IS NOT NULL;
CREATE TABLE _mig12_print_assign AS
  SELECT id, assigned_user_id AS uid FROM print_jobs WHERE assigned_user_id IS NOT NULL;
CREATE TABLE _mig12_sessions AS SELECT * FROM sessions;
CREATE TABLE _mig12_otps AS SELECT * FROM login_otps;
CREATE TABLE _mig12_notes AS
  SELECT id, user_id AS uid FROM job_notes WHERE user_id IS NOT NULL;
CREATE TABLE _mig12_photos AS
  SELECT id, uploaded_by AS uid FROM job_photos WHERE uploaded_by IS NOT NULL;
CREATE TABLE _mig12_flogs AS
  SELECT id, created_by AS uid FROM job_field_logs WHERE created_by IS NOT NULL;
CREATE TABLE _mig12_pfiles AS
  SELECT id, uploaded_by AS uid FROM print_files WHERE uploaded_by IS NOT NULL;

UPDATE jobs SET assigned_user_id = NULL WHERE assigned_user_id IS NOT NULL;
UPDATE recurring_jobs SET assigned_user_id = NULL WHERE assigned_user_id IS NOT NULL;
UPDATE print_jobs SET assigned_user_id = NULL WHERE assigned_user_id IS NOT NULL;
UPDATE job_notes SET user_id = NULL WHERE user_id IS NOT NULL;
UPDATE job_photos SET uploaded_by = NULL WHERE uploaded_by IS NOT NULL;
UPDATE job_field_logs SET created_by = NULL WHERE created_by IS NOT NULL;
UPDATE print_files SET uploaded_by = NULL WHERE uploaded_by IS NOT NULL;
DELETE FROM login_otps;
DELETE FROM sessions;

ALTER TABLE users RENAME TO users_old;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL
    CHECK (role IN ('owner', 'dispatcher', 'lead_tech', 'tech')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  must_change_password INTEGER NOT NULL DEFAULT 0
);

INSERT INTO users (id, email, name, password_hash, role, created_at, must_change_password)
SELECT id, email, name, password_hash, role, created_at, must_change_password
FROM users_old;

DROP TABLE users_old;

INSERT INTO sessions SELECT * FROM _mig12_sessions;
INSERT INTO login_otps SELECT * FROM _mig12_otps;

UPDATE jobs
SET assigned_user_id = (SELECT uid FROM _mig12_job_assign WHERE _mig12_job_assign.id = jobs.id)
WHERE id IN (SELECT id FROM _mig12_job_assign);

UPDATE recurring_jobs
SET assigned_user_id = (SELECT uid FROM _mig12_rec_assign WHERE _mig12_rec_assign.id = recurring_jobs.id)
WHERE id IN (SELECT id FROM _mig12_rec_assign);

UPDATE print_jobs
SET assigned_user_id = (SELECT uid FROM _mig12_print_assign WHERE _mig12_print_assign.id = print_jobs.id)
WHERE id IN (SELECT id FROM _mig12_print_assign);

UPDATE job_notes
SET user_id = (SELECT uid FROM _mig12_notes WHERE _mig12_notes.id = job_notes.id)
WHERE id IN (SELECT id FROM _mig12_notes);

UPDATE job_photos
SET uploaded_by = (SELECT uid FROM _mig12_photos WHERE _mig12_photos.id = job_photos.id)
WHERE id IN (SELECT id FROM _mig12_photos);

UPDATE job_field_logs
SET created_by = (SELECT uid FROM _mig12_flogs WHERE _mig12_flogs.id = job_field_logs.id)
WHERE id IN (SELECT id FROM _mig12_flogs);

UPDATE print_files
SET uploaded_by = (SELECT uid FROM _mig12_pfiles WHERE _mig12_pfiles.id = print_files.id)
WHERE id IN (SELECT id FROM _mig12_pfiles);

DROP TABLE _mig12_job_assign;
DROP TABLE _mig12_rec_assign;
DROP TABLE _mig12_print_assign;
DROP TABLE _mig12_sessions;
DROP TABLE _mig12_otps;
DROP TABLE _mig12_notes;
DROP TABLE _mig12_photos;
DROP TABLE _mig12_flogs;
DROP TABLE _mig12_pfiles;
