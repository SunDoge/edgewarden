-- Bitwarden's current two-factor WebAuthn contract addresses credentials with
-- small integer key IDs. Keep the internal UUID primary key for storage and
-- assign a stable, per-user protocol ID only to second-factor credentials.
ALTER TABLE webauthn_credentials ADD COLUMN provider_key_id INTEGER;

UPDATE webauthn_credentials AS credential
SET provider_key_id = (
  SELECT COUNT(*)
  FROM webauthn_credentials AS preceding
  WHERE preceding.user_id = credential.user_id
    AND preceding.purpose = 'twoFactor'
    AND (
      preceding.created_at < credential.created_at
      OR (
        preceding.created_at = credential.created_at
        AND preceding.id < credential.id
      )
    )
)
WHERE credential.purpose = 'twoFactor';

CREATE UNIQUE INDEX idx_webauthn_credentials_two_factor_key
  ON webauthn_credentials(user_id, provider_key_id)
  WHERE purpose = 'twoFactor';
