-- Random per-attempt token used to fence one-time authentication request
-- consumption and its session side effects inside a single D1 batch.
ALTER TABLE auth_requests ADD COLUMN consumption_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_requests_consumption_token
  ON auth_requests(consumption_token)
  WHERE consumption_token IS NOT NULL;
