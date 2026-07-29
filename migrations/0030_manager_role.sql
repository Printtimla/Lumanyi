-- MG-0: intended to widen users.role CHECK to include 'manager'.
-- Recreating `users` fails on production D1 (FOREIGN KEY constraint / child tables).
-- Same lesson as 0012_lead_tech_role.sql.
--
-- App behavior:
-- - designation = 'manager' resolves to permission role manager (resolvePermissionRole)
-- - users.role column stays within owner|dispatcher|tech (dbRoleForStorage maps manager → dispatcher)
-- Staging may already have applied an earlier recreate; that is fine.

SELECT 1;
