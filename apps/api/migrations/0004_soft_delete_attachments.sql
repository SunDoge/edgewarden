-- Keep attachment metadata as a tombstone until R2/KV deletion succeeds.
ALTER TABLE attachments ADD COLUMN deleted_at INTEGER;

CREATE INDEX idx_attachments_deleted_at
ON attachments(deleted_at)
WHERE deleted_at IS NOT NULL;
