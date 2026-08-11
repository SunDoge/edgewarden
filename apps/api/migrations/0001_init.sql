-- =============================================================================
-- REDESIGNED SCHEMA — edgewarden (modelled after Vaultwarden domains)
-- =============================================================================
-- Principles:
--   1. All timestamps are INTEGER (Unix seconds). No more TEXT/INTEGER mix.
--   2. CHECK constraints on every enum-like column.
--   3. Organisation + collection model for vault sharing (first-class).
--   4. Rate limiting is handled by Cloudflare Workers Rate Limiting binding.
--   5. Full set of cleanup-friendly indexes (expires_at, deleted_at, purge_after).
--   6. audit_logs has a reverse-lookup index on (target_type, target_id).
--   7. sends tracks password hash algorithm so it is upgradeable.
--   8. Cipher ownership is enforced: personal XOR org, never both.
-- =============================================================================
PRAGMA foreign_keys = ON;
-- ---------------------------------------------------------------------------
-- 1. CONFIG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
-- ---------------------------------------------------------------------------
-- 2. USERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  master_password_hint TEXT,
  master_password_hash TEXT NOT NULL,
  -- Encrypted vault key (protected by master password)
  key TEXT NOT NULL,
  private_key TEXT,
  public_key TEXT,
  -- KDF parameters travel with the user so clients can migrate algorithms
  kdf_type INTEGER NOT NULL CHECK (kdf_type IN (0, 1)),
  -- 0 = PBKDF2-SHA256, 1 = Argon2id
  kdf_iterations INTEGER NOT NULL,
  kdf_memory INTEGER,
  kdf_parallelism INTEGER,
  -- Incrementing stamp; changing it silently revokes all outstanding tokens
  -- without touching the token tables
  security_stamp TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  -- Require 2FA device-trust verification for new devices
  verify_devices INTEGER NOT NULL DEFAULT 1 CHECK (verify_devices IN (0, 1)),
  -- TOTP second factor (kept in users for zero-knowledge simplicity)
  totp_secret TEXT,
  totp_recovery_code TEXT,
  yubikey_config TEXT NOT NULL DEFAULT '{"keys":[],"nfc":false}' CHECK (
    json_valid(yubikey_config)
    AND json_type(yubikey_config, '$') = 'object'
    AND json_type(yubikey_config, '$.keys') = 'array'
    AND json_array_length(yubikey_config, '$.keys') <= 5
    AND json_type(yubikey_config, '$.nfc') IN ('true', 'false')
  ),
  -- Machine-account / CLI token
  api_key TEXT,
  created_at INTEGER NOT NULL,
  -- Unix seconds
  updated_at INTEGER NOT NULL
);
-- email is already UNIQUE; add a plain index for case-insensitive prefix lookups
-- if needed (SQLite UNIQUE is case-sensitive for ASCII by default)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key
  ON users(api_key) WHERE api_key IS NOT NULL;
-- ---------------------------------------------------------------------------
-- 3. DOMAIN SETTINGS  (one row per user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_settings (
  user_id TEXT PRIMARY KEY NOT NULL,
  equivalent_domains TEXT NOT NULL DEFAULT '[]',
  custom_equivalent_domains TEXT NOT NULL DEFAULT '[]',
  excluded_global_equivalent_domains TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- ---------------------------------------------------------------------------
-- 4. USER REVISIONS  (sync heartbeat — isolated to avoid locking users row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_revisions (
  user_id TEXT PRIMARY KEY NOT NULL,
  revision_date INTEGER NOT NULL,
  -- Unix seconds
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- ---------------------------------------------------------------------------
-- 5. ORGANISATIONS
-- ---------------------------------------------------------------------------
-- An organization owns shared vaults (collections). A user can be a member
-- of many organizations; a cipher is owned by exactly one user OR one org.
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT,
  private_key TEXT,
  -- client-encrypted
  owner_id TEXT NOT NULL,
  -- must also have a row in org_members
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_id);
-- ---------------------------------------------------------------------------
-- 6. ORG MEMBERS
-- ---------------------------------------------------------------------------
-- Pending invites: user_id may be NULL until the invite is accepted.
CREATE TABLE IF NOT EXISTS org_members (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT,
  -- NULL while status = 'invited'
  email TEXT NOT NULL,
  -- invitation target; kept for audit
  key TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'manager', 'member')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (
    status IN ('invited', 'accepted', 'confirmed', 'revoked')
  ),
  -- access_all = 1 means the member can see every collection in the org
  access_all INTEGER NOT NULL DEFAULT 0 CHECK (access_all IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE
  SET NULL
);
CREATE INDEX IF NOT EXISTS idx_org_members_org_status ON org_members(org_id, status);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_org_email ON org_members(org_id, email);
-- ---------------------------------------------------------------------------
-- 7. COLLECTIONS  (org-level folder for shared ciphers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- client-encrypted
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collections_org ON collections(org_id);
-- ---------------------------------------------------------------------------
-- 8. COLLECTION MEMBERS  (access control: which members can see which collections)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_members (
  collection_id TEXT NOT NULL,
  org_member_id TEXT NOT NULL,
  read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
  hide_passwords INTEGER NOT NULL DEFAULT 0 CHECK (hide_passwords IN (0, 1)),
  PRIMARY KEY (collection_id, org_member_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (org_member_id) REFERENCES org_members(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collection_members_member ON collection_members(org_member_id);
-- ---------------------------------------------------------------------------
-- 9. FOLDERS  (personal only; org ciphers use collections instead)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- client-encrypted
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_id_user ON folders(id, user_id);
CREATE INDEX IF NOT EXISTS idx_folders_user_updated ON folders(user_id, updated_at);
-- ---------------------------------------------------------------------------
-- 10. CIPHERS
-- ---------------------------------------------------------------------------
-- Ownership rule: a cipher belongs to exactly one owner.
--   Personal cipher : user_id IS NOT NULL, org_id IS NULL
--   Org cipher      : org_id  IS NOT NULL, user_id IS NULL
-- Enforced by the CHECK below.
CREATE TABLE IF NOT EXISTS ciphers (
  id TEXT PRIMARY KEY NOT NULL,
  -- Exactly one of these two is non-NULL (enforced by CHECK)
  user_id TEXT,
  org_id TEXT,
  type INTEGER NOT NULL CHECK (type BETWEEN 1 AND 8),
  -- 1=Login, 2=SecureNote, 3=Card, 4=Identity, 5=SSH key,
  -- 6=Bank account, 7=Driver license, 8=Passport
  -- Personal folder (NULL for org ciphers — use cipher_collections instead)
  folder_id TEXT,
  name TEXT NOT NULL,
  -- client-encrypted (NOT NULL for integrity)
  notes TEXT,
  -- client-encrypted
  fields TEXT,
  password_history TEXT,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  -- All type-specific fields are in data (client-encrypted JSON blob)
  data TEXT NOT NULL,
  reprompt INTEGER NOT NULL DEFAULT 0 CHECK (reprompt IN (0, 1)),
  -- Per-item encryption key (Bitwarden cipher key rotation support)
  key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Soft states: archived and deleted are independent
  archived_at INTEGER,
  deleted_at INTEGER,
  -- When to permanently purge (set by cleanup job; e.g. deleted_at + 30 days)
  -- NULL = not yet scheduled for purge
  purge_after INTEGER,
  CHECK (
    (
      user_id IS NOT NULL
      AND org_id IS NULL
    )
    OR (
      user_id IS NULL
      AND org_id IS NOT NULL
    )
  ),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id, user_id) REFERENCES folders(id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ciphers_user_updated ON ciphers(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ciphers_user_archived ON ciphers(user_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_ciphers_user_deleted ON ciphers(user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_ciphers_user_deleted_updated ON ciphers(user_id, deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_ciphers_user_folder ON ciphers(user_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_ciphers_org_updated ON ciphers(org_id, updated_at);
-- Cleanup job: find all rows due for permanent purge
CREATE INDEX IF NOT EXISTS idx_ciphers_purge_after ON ciphers(purge_after)
WHERE purge_after IS NOT NULL;
-- ---------------------------------------------------------------------------
-- 11. CIPHER COLLECTIONS  (many-to-many: org ciphers ↔ collections)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cipher_collections (
  cipher_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  PRIMARY KEY (cipher_id, collection_id),
  FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cipher_collections_collection ON cipher_collections(collection_id);
-- ---------------------------------------------------------------------------
-- 12. ATTACHMENTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY NOT NULL,
  cipher_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  -- client-encrypted
  size INTEGER NOT NULL,
  size_name TEXT NOT NULL,
  key TEXT,
  -- client-encrypted attachment key
  created_at INTEGER NOT NULL,
  FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attachments_cipher ON attachments(cipher_id);
-- ---------------------------------------------------------------------------
-- 13. SENDS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sends (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  org_id TEXT,
  type INTEGER NOT NULL CHECK (type IN (0, 1)),
  -- 0=Text, 1=File
  name TEXT NOT NULL,
  -- client-encrypted
  notes TEXT,
  -- client-encrypted
  data TEXT NOT NULL,
  -- client-encrypted
  key TEXT NOT NULL,
  -- client-encrypted Send key
  -- Optional password protection
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  -- Track which algorithm was used so it is independently upgradeable
  password_algorithm TEXT CHECK (
    password_algorithm IN ('pbkdf2-sha256', 'argon2id')
  ),
  auth_type INTEGER NOT NULL DEFAULT 2 CHECK (auth_type IN (0, 1, 2)),
  -- 0=Email, 1=Password, 2=None
  emails TEXT,
  -- JSON array of allowed email addresses
  max_access_count INTEGER,
  access_count INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  hide_email INTEGER CHECK (hide_email IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expiration_date INTEGER,
  -- Unix seconds; NULL = no expiry
  deletion_date INTEGER NOT NULL,
  -- Unix seconds; hard deadline
  -- password fields must all be present or all absent together with auth_type=1
  CHECK (
    (auth_type = 1 AND password_hash IS NOT NULL AND password_algorithm IS NOT NULL)
    OR (auth_type != 1 AND password_hash IS NULL)
  ),
  CHECK (
    (user_id IS NOT NULL AND org_id IS NULL)
    OR (user_id IS NULL AND org_id IS NOT NULL)
  ),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sends_user_updated ON sends(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_sends_org_updated ON sends(org_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_sends_user_deletion ON sends(user_id, deletion_date);
CREATE INDEX IF NOT EXISTS idx_sends_deletion ON sends(deletion_date);
-- cleanup
CREATE INDEX IF NOT EXISTS idx_sends_expiration ON sends(expiration_date) -- cleanup
WHERE expiration_date IS NOT NULL;
-- ---------------------------------------------------------------------------
-- 14. REFRESH TOKENS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Unix seconds
  device_identifier TEXT,
  device_session_stamp TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
-- cleanup
-- ---------------------------------------------------------------------------
-- 15. DEVICES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  user_id TEXT NOT NULL,
  device_identifier TEXT NOT NULL,
  name TEXT NOT NULL,
  type INTEGER NOT NULL,
  -- Bitwarden DeviceType; range is large, no CHECK
  session_stamp TEXT,
  encrypted_user_key TEXT,
  encrypted_public_key TEXT,
  encrypted_private_key TEXT,
  banned INTEGER NOT NULL DEFAULT 0 CHECK (banned IN (0, 1)),
  banned_at INTEGER,
  device_note TEXT,
  last_seen_at INTEGER,
  -- Unix seconds
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_identifier),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_devices_user_updated ON devices(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_devices_user_last_seen ON devices(user_id, last_seen_at);
-- ---------------------------------------------------------------------------
-- 16. AUTH REQUESTS  (passwordless / device approval flow)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  organization_id TEXT,
  type INTEGER NOT NULL CHECK (type IN (0, 1, 2)),
  request_device_identifier TEXT NOT NULL,
  request_device_type INTEGER NOT NULL,
  request_ip_address TEXT,
  request_country_name TEXT,
  response_device_identifier TEXT,
  access_code TEXT NOT NULL,
  public_key TEXT NOT NULL,
  key TEXT,
  master_password_hash TEXT,
  approved INTEGER CHECK (approved IN (0, 1)),
  creation_date INTEGER NOT NULL,
  -- Unix seconds
  response_date INTEGER,
  authentication_date INTEGER,
  FOREIGN KEY (user_id)           REFERENCES users(id)         ON DELETE CASCADE,
  FOREIGN KEY (organization_id)   REFERENCES organizations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_requests_user_created ON auth_requests(user_id, creation_date);
CREATE INDEX IF NOT EXISTS idx_auth_requests_user_pending ON auth_requests(
  user_id,
  approved,
  response_date,
  authentication_date,
  creation_date
);
CREATE INDEX IF NOT EXISTS idx_auth_requests_device_pending ON auth_requests(
  user_id,
  request_device_identifier,
  creation_date
);
-- ---------------------------------------------------------------------------
-- 17. TRUSTED TWO-FACTOR DEVICE TOKENS
-- ---------------------------------------------------------------------------
-- Decoupled from refresh tokens: a user can trust a device for 2FA without
-- the device remaining logged in.
CREATE TABLE IF NOT EXISTS device_trust_tokens (
  token TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  device_identifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  -- Unix seconds
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_t2f_tokens_user_device ON device_trust_tokens(user_id, device_identifier);
CREATE INDEX IF NOT EXISTS idx_t2f_tokens_expires_at ON device_trust_tokens(expires_at);
-- cleanup
-- ---------------------------------------------------------------------------
-- 18. WEBAUTHN CREDENTIALS  (passkeys & security keys)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  type TEXT,
  aa_guid TEXT,
  transports TEXT,
  -- JSON array
  encrypted_user_key TEXT,
  encrypted_public_key TEXT,
  encrypted_private_key TEXT,
  supports_prf INTEGER NOT NULL DEFAULT 0 CHECK (supports_prf IN (0, 1)),
  purpose TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('login', 'twoFactor')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credentials_credential_id ON webauthn_credentials(credential_id);
-- idx_webauthn_credentials_user is omitted: (user_id, updated_at) covers user_id lookups via prefix
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_updated ON webauthn_credentials(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_purpose ON webauthn_credentials(user_id, purpose, created_at);
-- ---------------------------------------------------------------------------
-- 19. WEBAUTHN CHALLENGES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge_hash TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('login', 'register', 'action')),
  user_id TEXT,
  -- NULL during registration (user not yet known)
  expires_at INTEGER NOT NULL,
  -- Unix seconds
  used_at INTEGER,
  -- non-NULL = consumed; prevents replay
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user_scope ON webauthn_challenges(user_id, scope);
-- ---------------------------------------------------------------------------
-- 20. USED ATTACHMENT DOWNLOAD TOKENS  (one-time download JWTs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachment_download_tokens (
  jti TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL -- Unix seconds; cleanup removes rows past this
);
CREATE INDEX IF NOT EXISTS idx_attachment_download_tokens_expires ON attachment_download_tokens(expires_at);
-- cleanup
-- ---------------------------------------------------------------------------
-- 21. INVITES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  created_by TEXT NOT NULL,
  used_by TEXT,
  expires_at INTEGER NOT NULL,
  -- Unix seconds
  status TEXT NOT NULL CHECK (
    status IN ('active', 'used', 'revoked', 'expired')
  ),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE
  SET NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_status_expires ON invites(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites(created_by, created_at);
CREATE INDEX IF NOT EXISTS idx_invites_email_status ON invites(email, status);
-- ---------------------------------------------------------------------------
-- 22. AUDIT LOGS
-- ---------------------------------------------------------------------------
-- actor_user_id uses SET NULL so logs are retained when a user is deleted
-- (compliance requirement). target_type + target_id is polymorphic: avoids
-- creating per-resource foreign keys while keeping reverse-lookup fast.
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'system' CHECK (
    category IN ('auth', 'vault', 'admin', 'system', 'org')
  ),
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'error')),
  target_type TEXT,
  -- e.g. 'cipher', 'user', 'org', 'send'
  target_id TEXT,
  metadata TEXT,
  -- JSON blob for extra context
  created_at INTEGER NOT NULL,
  -- Unix seconds
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE
  SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON audit_logs(actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_category_created ON audit_logs(category, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_level_created ON audit_logs(level, created_at);
-- Reverse lookup: "show me the full history of cipher <id>"
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id, created_at);
