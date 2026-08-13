-- Bitwarden mobile push relay registration for each authenticated device.
ALTER TABLE devices ADD COLUMN push_token TEXT;
ALTER TABLE devices ADD COLUMN push_uuid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_push_uuid
  ON devices(push_uuid) WHERE push_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devices_user_push
  ON devices(user_id) WHERE push_token IS NOT NULL;
