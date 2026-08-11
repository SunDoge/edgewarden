// ── KDF ──────────────────────────────────────────────────────────────────────

export const KdfType = {
	Pbkdf2: 0,
	Argon2id: 1,
} as const;
export type KdfType = (typeof KdfType)[keyof typeof KdfType];

// ── Cipher Type ──────────────────────────────────────────────────────────────

export const CipherType = {
	Login: 1,
	SecureNote: 2,
	Card: 3,
	Identity: 4,
	SshKey: 5,
	BankAccount: 6,
	DriversLicense: 7,
	Passport: 8,
} as const;
export type CipherType = (typeof CipherType)[keyof typeof CipherType];

// ── Request payloads ─────────────────────────────────────────────────────────

/** POST /api/accounts/register */
export interface RegisterPayload {
	email: string;
	masterPasswordHash: string;
	masterPasswordHint?: string;
	key: string;
	kdf: KdfType;
	kdfIterations: number;
	kdfMemory?: number;
	kdfParallelism?: number;
	name?: string;
	inviteCode?: string;
	keys?: {
		publicKey: string;
		encryptedPrivateKey: string;
	};
}

// ── API response shapes ───────────────────────────────────────────────────────

/** POST /identity/accounts/prelogin */
export interface PreloginResponse {
	kdf: KdfType;
	kdfIterations: number;
	kdfMemory: number | null;
	kdfParallelism: number | null;
	Salt: string;
}

/** POST /identity/connect/token */
export interface TokenResponse {
	access_token: string;
	expires_in: number;
	token_type: string;
	refresh_token: string;
	Key: string;
	PrivateKey: string | null;
	Kdf: KdfType;
	KdfIterations: number;
	KdfMemory: number | null;
	KdfParallelism: number | null;
}

/** Cipher item in sync response */
export interface AttachmentResponse {
	id: string;
	fileName: string;
	size: number;
	sizeName: string;
	key: string | null;
	object: "attachment";
}

export interface CipherResponse {
	id: string;
	organizationId: string | null;
	folderId: string | null;
	type: number;
	name: string;
	notes: string | null;
	fields: unknown[] | null;
	data: null;
	login: Record<string, unknown> | null;
	secureNote: Record<string, unknown> | null;
	card: Record<string, unknown> | null;
	identity: Record<string, unknown> | null;
	sshKey: Record<string, unknown> | null;
	bankAccount?: Record<string, unknown> | null;
	driversLicense?: Record<string, unknown> | null;
	passport?: Record<string, unknown> | null;
	favorite: boolean;
	reprompt: number;
	key: string | null;
	attachments: AttachmentResponse[] | null;
	collectionIds: string[];
	revisionDate: string;
	creationDate: string;
	deletedDate: string | null;
	archivedDate: string | null;
	passwordHistory: unknown[] | null;
	object: "cipher";
}

/** Folder item in sync response */
export interface FolderResponse {
	id: string;
	name: string;
	revisionDate: string;
	object: "folder";
}

export interface ProfileOrganizationResponse {
	id: string;
	name: string;
	key: string;
	publicKey: string | null;
	privateKey: string | null;
	role: "owner" | "admin" | "manager" | "member";
	status: string;
	accessAll: boolean;
	creationDate?: string;
	revisionDate?: string;
	object?: "profileOrganization";
}

export interface CollectionResponse {
	id: string;
	organizationId: string;
	name: string;
	readOnly: boolean;
	hidePasswords: boolean;
	creationDate: string;
	revisionDate: string;
	object: "collectionDetails";
}

/** GET /api/sync */
export interface SyncResponse {
	profile: {
		id: string;
		name: string | null;
		email: string;
		emailVerified: boolean;
		premium: boolean;
		key: string;
		privateKey: string | null;
		publicKey: string | null;
		organizations: ProfileOrganizationResponse[];
		kdf: KdfType;
		kdfIterations: number;
		kdfMemory: number | null;
		kdfParallelism: number | null;
		twoFactorEnabled: boolean;
		role: string;
		object: "profile";
	};
	ciphers: CipherResponse[];
	folders: FolderResponse[];
	collections: CollectionResponse[];
	sends: unknown[];
	policies: unknown[];
	object: "sync";
}

// ── Domain Settings ─────────────────────────────────────────────────────────

export interface CustomEquivalentDomain {
	id: string;
	domains: string[];
	excluded: boolean;
}

export interface GlobalEquivalentDomain {
	type: number;
	domains: string[];
	excluded: boolean;
	[key: string]: unknown;
}

export interface DomainRulesResponse {
	equivalentDomains: string[][];
	customEquivalentDomains: CustomEquivalentDomain[];
	globalEquivalentDomains: GlobalEquivalentDomain[];
	object: "domains";
}
