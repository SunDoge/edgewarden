ALTER TABLE webauthn_credentials
ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login'
CHECK (purpose IN ('login', 'twoFactor'));

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_purpose
ON webauthn_credentials(user_id, purpose, created_at);
