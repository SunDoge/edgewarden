-- Claims an expired Send while maintenance removes its external file object.
ALTER TABLE sends ADD COLUMN purge_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sends_purge_token
  ON sends(purge_token)
  WHERE purge_token IS NOT NULL;
