CREATE TABLE emergency_access (
  id TEXT PRIMARY KEY NOT NULL,
  grantor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grantee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_encrypted TEXT,
  type INTEGER NOT NULL CHECK (type IN (0, 1)),
  status INTEGER NOT NULL CHECK (status IN (1, 2, 3, 4)),
  wait_time_days INTEGER NOT NULL CHECK (wait_time_days BETWEEN 1 AND 90),
  recovery_initiated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (grantor_id <> grantee_id),
  CHECK ((status = 1 AND key_encrypted IS NULL) OR (status <> 1 AND key_encrypted IS NOT NULL)),
  CHECK ((status IN (3, 4) AND recovery_initiated_at IS NOT NULL) OR (status IN (1, 2) AND recovery_initiated_at IS NULL)),
  UNIQUE (grantor_id, grantee_id)
);

CREATE INDEX idx_emergency_access_grantor ON emergency_access(grantor_id, updated_at DESC);
CREATE INDEX idx_emergency_access_grantee ON emergency_access(grantee_id, updated_at DESC);
CREATE INDEX idx_emergency_access_due
  ON emergency_access(recovery_initiated_at, wait_time_days)
  WHERE status = 3;
