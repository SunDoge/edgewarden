-- Whole-instance restore replaces attachment rows atomically, so old object
-- keys need an independent durable tombstone for retryable R2/KV cleanup.
CREATE TABLE blob_gc_queue (
  object_key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_blob_gc_queue_due
ON blob_gc_queue(next_attempt_at, created_at);
