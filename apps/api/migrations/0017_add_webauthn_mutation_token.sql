-- Internal optimistic-concurrency token for WebAuthn credential mutations.
-- It is deliberately omitted from portable backups and regenerated on write.
ALTER TABLE webauthn_credentials ADD COLUMN mutation_token TEXT;

UPDATE webauthn_credentials
SET mutation_token = lower(hex(randomblob(16)))
WHERE mutation_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credentials_mutation_token
ON webauthn_credentials(mutation_token)
WHERE mutation_token IS NOT NULL;
