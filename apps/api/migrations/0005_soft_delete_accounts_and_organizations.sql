-- Account and organization deletion spans D1 plus R2/KV. Keep the owning row
-- until scheduled GC has removed every external object and dependent row.
ALTER TABLE users ADD COLUMN deletion_requested_at INTEGER;
ALTER TABLE organizations ADD COLUMN deletion_requested_at INTEGER;

CREATE INDEX idx_users_deletion_requested
ON users(deletion_requested_at)
WHERE deletion_requested_at IS NOT NULL;

CREATE INDEX idx_organizations_deletion_requested
ON organizations(deletion_requested_at)
WHERE deletion_requested_at IS NOT NULL;
