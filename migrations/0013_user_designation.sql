-- Employee designation (Owner / Dispatcher / Lead Tech / Tech) without recreating users.
-- Permission role stays owner|dispatcher|tech; lead_tech is designation-only.

ALTER TABLE users ADD COLUMN designation TEXT;

UPDATE users SET designation = role WHERE designation IS NULL;
