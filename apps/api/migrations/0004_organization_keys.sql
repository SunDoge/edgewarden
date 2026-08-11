ALTER TABLE organizations ADD COLUMN public_key TEXT;
ALTER TABLE organizations ADD COLUMN private_key TEXT;
ALTER TABLE org_members ADD COLUMN key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_org_email
ON org_members(org_id, email);
