-- Intentionally no-op.
-- Recreating `users` to widen the role CHECK fails on D1 when FKs exist
-- (sessions / assigned jobs). Designations are handled in 0013 via a new column.

SELECT 1;
