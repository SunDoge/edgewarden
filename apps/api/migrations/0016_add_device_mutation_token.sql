-- Fence device metadata and trusted-key updates against concurrent writes and
-- deletion/re-login cycles that reuse the same client-provided identifier.
ALTER TABLE devices ADD COLUMN mutation_token TEXT;

CREATE INDEX IF NOT EXISTS idx_devices_mutation_token
  ON devices(mutation_token)
  WHERE mutation_token IS NOT NULL;
