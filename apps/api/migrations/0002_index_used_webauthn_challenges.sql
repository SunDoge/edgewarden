-- Passkey challenges are deleted after use. Index only consumed rows so the
-- scheduled cleanup avoids scanning outstanding challenges while keeping the
-- write/storage cost smaller than a full-column index.
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_used
	ON webauthn_challenges(used_at)
	WHERE used_at IS NOT NULL;
