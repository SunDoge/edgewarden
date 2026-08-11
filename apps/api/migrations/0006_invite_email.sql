ALTER TABLE invites ADD COLUMN email TEXT;
CREATE INDEX IF NOT EXISTS idx_invites_email_status ON invites(email, status);
