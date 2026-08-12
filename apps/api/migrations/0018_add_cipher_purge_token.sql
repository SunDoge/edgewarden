-- Prevent a cipher restore from racing external attachment deletion during GC.
-- Portable backups omit this internal maintenance claim token.
ALTER TABLE ciphers ADD COLUMN purge_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ciphers_purge_token
ON ciphers(purge_token)
WHERE purge_token IS NOT NULL;
