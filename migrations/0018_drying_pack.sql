-- Optional psychrometric fields on moisture field logs (drying pack).

ALTER TABLE job_field_logs ADD COLUMN temp_f REAL;
ALTER TABLE job_field_logs ADD COLUMN rh_pct REAL;
ALTER TABLE job_field_logs ADD COLUMN grains REAL;
