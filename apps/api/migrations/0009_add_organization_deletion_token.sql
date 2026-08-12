-- Request-unique ownership marker for atomic organization deletion batches.
-- It prevents a losing concurrent request from tombstoning child data or
-- publishing duplicate member revisions and audit events.
ALTER TABLE organizations ADD COLUMN deletion_token TEXT;
