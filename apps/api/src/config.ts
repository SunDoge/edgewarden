export const LIMITS = {
  auth: {
    accessTokenTtlSeconds: 7200,
    refreshTokenTtlSeconds: 365 * 24 * 60 * 60,
    refreshTokenRandomBytes: 32,
    jwtSecretMinLength: 32,
    defaultKdfIterations: 600000,
    twoFactorRememberTtlSeconds: 30 * 24 * 60 * 60,
    fileDownloadTokenTtlSeconds: 900,
    sendAccessTokenTtlSeconds: 900,
    loginFailureWindowSeconds: 15 * 60,
    loginFailureLimit: 5,
    loginLockoutSeconds: 15 * 60,
  },
  requestBody: {
    jsonBytes: 10 * 1024 * 1024,
    formBytes: 256 * 1024,
    blobBytes: 105 * 1024 * 1024,
  },
  send: {
    maxFileSizeBytes: 100 * 1024 * 1024, // 100MB
    maxDeletionDays: 30,
  },
  attachment: {
    maxFileSizeBytes: 100 * 1024 * 1024,
  },
  cipher: {
    trashRetentionSeconds: 30 * 24 * 60 * 60,
  },
  cors: {
    preflightMaxAgeSeconds: 86400,
  },
  compatibility: {
    // Clients use this value to select backward-compatibility serializers.
    // Keep it aligned with the newest Bitwarden protocol level we implement.
    bitwardenServerVersion: "2026.6.0",
    // Edgewarden currently persists cipher keys as opaque legacy EncStrings. The
    // newer cipher-key-encryption protocol uses a different key representation;
    // advertising it makes current clients create keys that legacy attachment
    // encryption cannot unwrap.
    cipherKeyEncryptionFeatureEnabled: false,
  },
  performance: {
    importItemLimit: 5000,
    bulkMoveChunkSize: 100,
  },
} as const;
