-- Fence Collection updates and deletion claims so permission and Cipher-link
-- checks remain valid for the complete D1 batch.
ALTER TABLE collections ADD COLUMN mutation_token TEXT;

CREATE INDEX IF NOT EXISTS idx_collections_mutation_token
  ON collections(mutation_token)
  WHERE mutation_token IS NOT NULL;
