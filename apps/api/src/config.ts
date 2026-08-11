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
		bitwardenServerVersion: "2026.4.1",
		cipherKeyEncryptionFeatureEnabled: true,
	},
	performance: {
		importItemLimit: 5000,
		bulkMoveChunkSize: 100,
	},
} as const;
