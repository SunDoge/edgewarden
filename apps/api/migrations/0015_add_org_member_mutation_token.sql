-- Fence organization member authorization and permission mutations across the
-- actor, target member, and referenced Collection set.
ALTER TABLE org_members ADD COLUMN mutation_token TEXT;

CREATE INDEX IF NOT EXISTS idx_org_members_mutation_token
  ON org_members(mutation_token)
  WHERE mutation_token IS NOT NULL;
