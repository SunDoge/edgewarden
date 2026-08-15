-- =============================================================================
-- EDGEWARDEN INITIAL SCHEMA (modelled after Vaultwarden domains)
-- =============================================================================
-- This is the complete baseline for a fresh deployment. After this baseline
-- reaches production, keep it immutable and add a numbered migration for each
-- schema change instead of editing this file in place.
--
-- Principles:
--   1. All timestamps are INTEGER (Unix seconds). No more TEXT/INTEGER mix.
--   2. CHECK constraints on every enum-like column.
--   3. Organisation + collection model for vault sharing (first-class).
--   4. Edge rate limiting is complemented by persisted account lockouts.
--   5. Full set of cleanup-friendly indexes (expires_at, deleted_at, purge_after).
--   6. audit_logs has a reverse-lookup index on (target_type, target_id).
--   7. sends tracks password hash algorithm so it is upgradeable.
--   8. Cipher ownership is enforced: personal XOR org, never both.
--   9. Every TEXT primary-key column explicitly declares NOT NULL because
--      SQLite does not imply it for non-INTEGER primary keys in rowid tables.
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
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  name TEXT,
  master_password_hint TEXT,
  master_password_hash TEXT NOT NULL,
  -- Encrypted vault key (protected by master password)
  key TEXT NOT NULL,
  private_key TEXT,
  public_key TEXT,
  -- Explicit salt decouples master-password derivation from mutable email.
  -- NULL keeps compatibility with legacy accounts that derive it from email.
  master_password_salt TEXT,
  signed_public_key TEXT,
  security_version INTEGER CHECK (security_version IS NULL OR security_version >= 0),
  security_state TEXT,
  v2_upgrade_token TEXT CHECK (v2_upgrade_token IS NULL OR json_valid(v2_upgrade_token)),
  user_key_id TEXT CHECK (user_key_id IS NULL OR length(user_key_id) = 32),
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
  -- AES-GCM envelopes protected by DATA_ENCRYPTION_SECRET.
  totp_secret TEXT CHECK (
    totp_secret IS NULL OR (
      json_valid(totp_secret)
      AND COALESCE(json_extract(totp_secret, '$.v'), 0) = 1
      AND COALESCE(json_type(totp_secret, '$.iv') = 'text', 0)
      AND COALESCE(json_type(totp_secret, '$.data') = 'text', 0)
    )
  ),
  totp_recovery_code TEXT CHECK (
    totp_recovery_code IS NULL OR (
      json_valid(totp_recovery_code)
      AND COALESCE(json_extract(totp_recovery_code, '$.v'), 0) = 1
      AND COALESCE(json_type(totp_recovery_code, '$.iv') = 'text', 0)
      AND COALESCE(json_type(totp_recovery_code, '$.data') = 'text', 0)
    )
  ),
  -- JSON keeps the five public IDs and NFC policy atomic and extensible.
  -- Yubico API credentials are encrypted separately in the config table.
  yubikey_config TEXT NOT NULL DEFAULT '{"keys":[],"nfc":false}' CHECK (
    json_valid(yubikey_config)
    AND COALESCE(json_type(yubikey_config, '$') = 'object', 0)
    AND COALESCE(json_type(yubikey_config, '$.keys') = 'array', 0)
    AND json_array_length(yubikey_config, '$.keys') <= 5
    AND COALESCE(json_type(yubikey_config, '$.nfc') IN ('true', 'false'), 0)
  ),
  -- Machine-account / CLI token: hash verifies authentication while the
  -- encrypted envelope preserves Bitwarden's authenticated retrieval API.
  api_key_hash TEXT,
  api_key_encrypted TEXT CHECK (
    api_key_encrypted IS NULL OR (
      json_valid(api_key_encrypted)
      AND COALESCE(json_extract(api_key_encrypted, '$.v'), 0) = 1
      AND COALESCE(json_type(api_key_encrypted, '$.iv') = 'text', 0)
      AND COALESCE(json_type(api_key_encrypted, '$.data') = 'text', 0)
    )
  ),
  created_at INTEGER NOT NULL,
  -- Unix seconds
  updated_at INTEGER NOT NULL,
	deletion_requested_at INTEGER,
	CHECK (
		(kdf_type = 0 AND kdf_iterations >= 100000 AND kdf_memory IS NULL AND kdf_parallelism IS NULL)
		OR
		(kdf_type = 1 AND kdf_iterations >= 2 AND kdf_memory IS NOT NULL AND kdf_memory >= 8 AND kdf_parallelism IS NOT NULL AND kdf_parallelism >= 1)
	),
	CHECK ((api_key_hash IS NULL) = (api_key_encrypted IS NULL))
);
-- email is already UNIQUE; add a plain index for case-insensitive prefix lookups
-- if needed (SQLite UNIQUE is case-sensitive for ASCII by default)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key_hash
  ON users(api_key_hash) WHERE api_key_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_deletion_requested
  ON users(deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;
-- ---------------------------------------------------------------------------
-- 3. LOGIN ATTEMPTS
-- ---------------------------------------------------------------------------
-- Account identifiers are SHA-256 hashes, never plaintext email addresses.
-- Persisting failures prevents an attacker from bypassing lockout by changing IP.
CREATE TABLE IF NOT EXISTS login_attempts (
  identifier_hash TEXT PRIMARY KEY NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at INTEGER NOT NULL,
  locked_until INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_updated ON login_attempts(updated_at);
-- ---------------------------------------------------------------------------
-- 4. DOMAIN SETTINGS  (one row per user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_settings (
  user_id TEXT PRIMARY KEY NOT NULL,
  equivalent_domains TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(equivalent_domains) AND json_type(equivalent_domains, '$') = 'array'),
  custom_equivalent_domains TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(custom_equivalent_domains) AND json_type(custom_equivalent_domains, '$') = 'array'),
  excluded_global_equivalent_domains TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(excluded_global_equivalent_domains) AND json_type(excluded_global_equivalent_domains, '$') = 'array'),
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
  -- Organization key pair generated and encrypted by Bitwarden-compatible clients.
  public_key TEXT,
  private_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
	deletion_requested_at INTEGER,
	deletion_token TEXT
);
CREATE INDEX IF NOT EXISTS idx_organizations_deletion_requested
  ON organizations(deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;
-- ---------------------------------------------------------------------------
-- 6. ORG MEMBERS
-- ---------------------------------------------------------------------------
-- Pending invites: user_id may be NULL until the invite is accepted.
CREATE TABLE IF NOT EXISTS org_members (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT,
  -- NULL while status = 'invited'
  email TEXT NOT NULL CHECK (email = lower(trim(email))),
  -- invitation target; kept for audit
  -- Client-encrypted organization key granted to this member.
  key TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'manager', 'member')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (
    status IN ('invited', 'accepted', 'confirmed', 'revoked')
  ),
  -- access_all = 1 means the member can see every collection in the org
  access_all INTEGER NOT NULL DEFAULT 0 CHECK (access_all IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
	mutation_token TEXT,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE
  SET NULL
);
CREATE INDEX IF NOT EXISTS idx_org_members_org_status ON org_members(org_id, status);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_org_email ON org_members(org_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_org_user
  ON org_members(org_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_members_mutation_token
  ON org_members(mutation_token) WHERE mutation_token IS NOT NULL;
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
	mutation_token TEXT,
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collections_org ON collections(org_id);
CREATE INDEX IF NOT EXISTS idx_collections_mutation_token
  ON collections(mutation_token) WHERE mutation_token IS NOT NULL;
-- ---------------------------------------------------------------------------
-- 8. COLLECTION MEMBERS  (access control: which members can see which collections)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collection_members (
  collection_id TEXT NOT NULL,
  org_member_id TEXT NOT NULL,
  read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
  hide_passwords INTEGER NOT NULL DEFAULT 0 CHECK (hide_passwords IN (0, 1)),
  manage INTEGER NOT NULL DEFAULT 0 CHECK (manage IN (0, 1)),
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
	mutation_token TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_id_user ON folders(id, user_id);
CREATE INDEX IF NOT EXISTS idx_folders_user_updated ON folders(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_folders_mutation_token
  ON folders(mutation_token) WHERE mutation_token IS NOT NULL;
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
  -- Personal-cipher view state. Organization ciphers keep per-member state in
  -- cipher_user_settings because favorite/archive/folder are user-specific.
  folder_id TEXT,
  name TEXT NOT NULL,
  -- client-encrypted (NOT NULL for integrity)
  notes TEXT,
  -- Client-encrypted custom fields and password history use Bitwarden wire JSON.
  fields TEXT CHECK (fields IS NULL OR (json_valid(fields) AND json_type(fields, '$') = 'array')),
  password_history TEXT CHECK (password_history IS NULL OR (json_valid(password_history) AND json_type(password_history, '$') = 'array')),
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  -- All type-specific fields are in data (client-encrypted JSON blob)
  data TEXT NOT NULL CHECK (json_valid(data) AND json_type(data, '$') = 'object'),
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
	mutation_token TEXT,
	purge_token TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_ciphers_purge_token
  ON ciphers(purge_token) WHERE purge_token IS NOT NULL;
-- ---------------------------------------------------------------------------
-- 11. ORGANIZATION CIPHER USER SETTINGS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cipher_user_settings (
  cipher_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  folder_id TEXT,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  archived_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (cipher_id, user_id),
  FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id, user_id) REFERENCES folders(id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cipher_user_settings_user_folder
  ON cipher_user_settings(user_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_cipher_user_settings_user_archived
  ON cipher_user_settings(user_id, archived_at);
-- ---------------------------------------------------------------------------
-- 12. CIPHER COLLECTIONS  (many-to-many: org ciphers ↔ collections)
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
	-- Versioned physical object key, independent from the public attachment ID.
	storage_key TEXT,
	deleted_at INTEGER,
	deletion_token TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attachments_cipher ON attachments(cipher_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_storage_key
  ON attachments(storage_key) WHERE storage_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_deleted_at
  ON attachments(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_deletion_token
  ON attachments(deletion_token) WHERE deletion_token IS NOT NULL;
-- Durable tombstones make external R2/KV deletion retryable after D1 commits.
CREATE TABLE IF NOT EXISTS blob_gc_queue (
  object_key TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blob_gc_queue_due
  ON blob_gc_queue(next_attempt_at, created_at);
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
	-- Versioned physical object key for file Sends.
	storage_key TEXT,
	-- Internal claim token used while scheduled maintenance purges a Send.
	purge_token TEXT,
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
  emails TEXT CHECK (emails IS NULL OR (json_valid(emails) AND json_type(emails, '$') = 'array')),
  -- JSON array of allowed email addresses
  max_access_count INTEGER CHECK (max_access_count IS NULL OR max_access_count >= 0),
  access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
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
    (auth_type = 1 AND password_hash IS NOT NULL AND password_salt IS NOT NULL AND password_iterations IS NOT NULL AND password_iterations > 0 AND password_algorithm IS NOT NULL)
    OR (auth_type != 1 AND password_hash IS NULL AND password_salt IS NULL AND password_iterations IS NULL AND password_algorithm IS NULL)
  ),
	CHECK (max_access_count IS NULL OR access_count <= max_access_count),
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_sends_storage_key
  ON sends(storage_key) WHERE storage_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sends_purge_token
  ON sends(purge_token) WHERE purge_token IS NOT NULL;
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
	mutation_token TEXT,
  PRIMARY KEY (user_id, device_identifier),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_devices_user_updated ON devices(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_devices_user_last_seen ON devices(user_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_devices_mutation_token
  ON devices(mutation_token) WHERE mutation_token IS NOT NULL;
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
  access_code_hash TEXT NOT NULL,
  access_code_encrypted TEXT NOT NULL CHECK (
    json_valid(access_code_encrypted)
    AND COALESCE(json_extract(access_code_encrypted, '$.v'), 0) = 1
    AND COALESCE(json_type(access_code_encrypted, '$.iv') = 'text', 0)
    AND COALESCE(json_type(access_code_encrypted, '$.data') = 'text', 0)
  ),
  public_key TEXT NOT NULL,
  key TEXT,
  master_password_hash TEXT,
  approved INTEGER CHECK (approved IN (0, 1)),
  creation_date INTEGER NOT NULL,
  -- Unix seconds
  response_date INTEGER,
  authentication_date INTEGER,
	consumption_token TEXT,
	CHECK (
		(approved IS NULL AND response_date IS NULL)
		OR (approved IS NOT NULL AND response_date IS NOT NULL)
	),
	CHECK (authentication_date IS NULL OR (approved = 1 AND response_date IS NOT NULL)),
  FOREIGN KEY (user_id)           REFERENCES users(id)         ON DELETE CASCADE,
  FOREIGN KEY (organization_id)   REFERENCES organizations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_requests_user_created ON auth_requests(user_id, creation_date);
CREATE INDEX IF NOT EXISTS idx_auth_requests_creation_date ON auth_requests(creation_date);
-- scheduled cleanup
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_requests_consumption_token
  ON auth_requests(consumption_token) WHERE consumption_token IS NOT NULL;
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
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  type TEXT,
  aa_guid TEXT,
  transports TEXT CHECK (transports IS NULL OR (json_valid(transports) AND json_type(transports, '$') = 'array')),
  -- JSON array
  encrypted_user_key TEXT,
  encrypted_public_key TEXT,
  encrypted_private_key TEXT,
  supports_prf INTEGER NOT NULL DEFAULT 0 CHECK (supports_prf IN (0, 1)),
  -- Prevent login passkeys and second-factor credentials from being interchanged.
  purpose TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('login', 'twoFactor')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
	mutation_token TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credentials_credential_id ON webauthn_credentials(credential_id);
-- idx_webauthn_credentials_user is omitted: (user_id, updated_at) covers user_id lookups via prefix
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_updated ON webauthn_credentials(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_purpose ON webauthn_credentials(user_id, purpose, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credentials_mutation_token
  ON webauthn_credentials(mutation_token) WHERE mutation_token IS NOT NULL;
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
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_used
  ON webauthn_challenges(used_at) WHERE used_at IS NOT NULL;
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
  -- code stores SHA-256(raw code); the encrypted envelope is only decrypted
  -- for authenticated admin responses.
  code_encrypted TEXT NOT NULL CHECK (
    json_valid(code_encrypted)
    AND COALESCE(json_extract(code_encrypted, '$.v'), 0) = 1
    AND COALESCE(json_type(code_encrypted, '$.iv') = 'text', 0)
    AND COALESCE(json_type(code_encrypted, '$.data') = 'text', 0)
  ),
  -- Lowercase normalized registration address bound to this one-time code.
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
  metadata TEXT CHECK (metadata IS NULL OR (json_valid(metadata) AND json_type(metadata, '$') = 'object')),
  -- JSON blob for extra context
  created_at INTEGER NOT NULL,
	is_tombstone INTEGER NOT NULL DEFAULT 0 CHECK (is_tombstone IN (0, 1)),
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
CREATE INDEX IF NOT EXISTS idx_audit_logs_retention
  ON audit_logs(created_at, id) WHERE is_tombstone = 0;

-- Deletion history is permanent evidence: deletion events must be marked as
-- tombstones, and existing tombstones cannot be rewritten or removed.
CREATE TRIGGER IF NOT EXISTS audit_logs_require_tombstone_marker
BEFORE INSERT ON audit_logs
WHEN (
  NEW.action LIKE '%.delete'
  OR NEW.action LIKE '%.delete.%'
  OR NEW.action LIKE '%.purged'
)
AND NEW.is_tombstone <> 1
BEGIN
  SELECT RAISE(ABORT, 'deletion audit events must be tombstones');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_protect_tombstone_delete
BEFORE DELETE ON audit_logs
WHEN OLD.is_tombstone = 1
AND NOT EXISTS (
  SELECT 1 FROM config
  WHERE key = 'backup.runner.lock.v1'
    AND json_valid(value)
    AND json_extract(value, '$.operation') LIKE 'backup.restore%'
    AND COALESCE(json_extract(value, '$.expiresAt'), 0) > unixepoch()
)
BEGIN
  SELECT RAISE(ABORT, 'audit tombstones cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_protect_tombstone_update
BEFORE UPDATE ON audit_logs
WHEN OLD.is_tombstone = 1
AND (
  NEW.id IS NOT OLD.id
  OR NEW.action IS NOT OLD.action
  OR NEW.category IS NOT OLD.category
  OR NEW.level IS NOT OLD.level
  OR NEW.target_type IS NOT OLD.target_type
  OR NEW.target_id IS NOT OLD.target_id
  OR NEW.metadata IS NOT OLD.metadata
  OR NEW.is_tombstone IS NOT OLD.is_tombstone
  OR NEW.created_at IS NOT OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'audit tombstones are immutable');
END;
