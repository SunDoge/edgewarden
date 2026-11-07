-- Retain deleted account identity for audit/recovery without reserving its
-- login address forever. Active accounts and organization ownership are untouched.
ALTER TABLE users ADD COLUMN deleted_email TEXT;

UPDATE users
SET deleted_email = email,
    master_password_salt = COALESCE(master_password_salt, email),
    email = 'deleted-' || lower(hex(randomblob(16))) || '@deleted.invalid'
WHERE deletion_requested_at IS NOT NULL
  AND deleted_email IS NULL;
