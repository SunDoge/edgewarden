-- Random per-attempt token used to fence attachment tombstone side effects.
ALTER TABLE attachments ADD COLUMN deletion_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_deletion_token
  ON attachments(deletion_token)
  WHERE deletion_token IS NOT NULL;
