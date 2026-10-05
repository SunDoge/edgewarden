-- Delayed V2 uploads need durable encrypted metadata so an authenticated
-- client can renew its short-lived upload URL without publishing the
-- attachment into sync before the blob exists.
CREATE TABLE IF NOT EXISTS attachment_uploads (
  id TEXT PRIMARY KEY NOT NULL,
  cipher_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachment_uploads_expiry
  ON attachment_uploads(expires_at);
