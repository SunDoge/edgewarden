-- Request-unique fencing marker for atomic Folder updates and cross-table
-- deletion batches. It prevents stale concurrent requests from advancing sync
-- revisions or moving Ciphers after another Folder mutation has already won.
ALTER TABLE folders ADD COLUMN mutation_token TEXT;

CREATE INDEX IF NOT EXISTS idx_folders_mutation_token
  ON folders(mutation_token)
  WHERE mutation_token IS NOT NULL;
