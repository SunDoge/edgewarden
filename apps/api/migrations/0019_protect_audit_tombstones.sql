-- Deletion history is evidence, not an operational log. Retention policies may
-- trim routine events but must not erase the fact that an object was deleted.
ALTER TABLE audit_logs ADD COLUMN is_tombstone INTEGER NOT NULL DEFAULT 0
  CHECK (is_tombstone IN (0, 1));

UPDATE audit_logs
SET is_tombstone = 1
WHERE action LIKE '%.delete'
   OR action LIKE '%.delete.%'
   OR action LIKE '%.purged';

CREATE INDEX IF NOT EXISTS idx_audit_logs_retention
ON audit_logs(created_at, id)
WHERE is_tombstone = 0;
