-- Audit tombstones are permanent evidence. Enforce their lifecycle in D1 so
-- future application changes cannot silently downgrade, rewrite, or delete
-- deletion history. actor_user_id remains mutable because its foreign key is
-- intentionally cleared when an account is removed and may be restored later.
CREATE TRIGGER IF NOT EXISTS audit_logs_require_tombstone_marker
BEFORE INSERT ON audit_logs
WHEN (
  NEW.action LIKE '%.delete'
  OR NEW.action LIKE '%.delete.%'
  OR NEW.action LIKE '%.purged'
)
AND NEW.is_tombstone <> 1
BEGIN
  SELECT RAISE(ABORT, 'deletion audit events must be tombstones');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_protect_tombstone_delete
BEFORE DELETE ON audit_logs
WHEN OLD.is_tombstone = 1
AND NOT EXISTS (
  -- The previously deployed Worker replaces audit rows inside an atomic
  -- shadow restore. Keep that rolling-deploy path compatible; the new Worker
  -- no longer deletes tombstones during restore.
  SELECT 1
  FROM config
  WHERE key = 'backup.runner.lock.v1'
    AND json_valid(value)
    AND json_extract(value, '$.operation') LIKE 'backup.restore%'
    AND COALESCE(json_extract(value, '$.expiresAt'), 0) > unixepoch()
)
BEGIN
  SELECT RAISE(ABORT, 'audit tombstones cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_protect_tombstone_update
BEFORE UPDATE ON audit_logs
WHEN OLD.is_tombstone = 1
AND (
  NEW.id IS NOT OLD.id
  OR NEW.action IS NOT OLD.action
  OR NEW.category IS NOT OLD.category
  OR NEW.level IS NOT OLD.level
  OR NEW.target_type IS NOT OLD.target_type
  OR NEW.target_id IS NOT OLD.target_id
  OR NEW.metadata IS NOT OLD.metadata
  OR NEW.is_tombstone IS NOT OLD.is_tombstone
  OR NEW.created_at IS NOT OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'audit tombstones are immutable');
END;
