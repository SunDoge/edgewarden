import { syncVault, logout as apiLogout } from "$lib/services/api";
import {
	deriveMasterKey,
	decryptCipher,
	hkdfExpand,
	decryptBw,
	decryptStr,
	bytesToBase64,
	base64ToBytes,
} from "$lib/services/crypto";
import {
	loadVaultSnapshot,
	saveVaultSnapshot,
	clearVaultSnapshot,
} from "$lib/services/vault-db";
import type {
	CipherResponse,
	FolderResponse,
	SyncResponse,
} from "@edgewarden/shared";
import { decryptOwnedSend } from "$lib/services/send-crypto";
import { importAccountPrivateKey, unwrapOrganizationKey } from "$lib/services/organization-crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncStatus = "idle" | "syncing" | "offline" | "error";

interface VaultState {
	ciphers: CipherResponse[];
	folders: FolderResponse[];
	collections: Record<string, any>[];
	organizations: Record<string, any>[];
	sends: Record<string, any>[];
	profile: SyncResponse["profile"] | null;
	syncedAt: number | null;
	status: SyncStatus;
	error: string | null;
	warning: string | null;
}

// ── Reactive state ────────────────────────────────────────────────────────────

let initialMasterKey: ArrayBuffer | null = null;
let initialSymEncKey: Uint8Array | null = null;
let initialSymMacKey: Uint8Array | null = null;

if (typeof window !== "undefined" && import.meta.env.DEV) {
	const mk = sessionStorage.getItem("dev_master_key");
	const sek = sessionStorage.getItem("dev_sym_enc_key");
	const smk = sessionStorage.getItem("dev_sym_mac_key");
	if (mk && sek && smk) {
		try {
			initialMasterKey = base64ToBytes(mk).buffer as ArrayBuffer;
			initialSymEncKey = base64ToBytes(sek);
			initialSymMacKey = base64ToBytes(smk);
		} catch (e) {
			console.error("Failed to restore keys from sessionStorage:", e);
		}
	}
}

/** Master key lives in memory only in production; in development, it is restored from sessionStorage to persist across hot reloads */
let _masterKey = $state<ArrayBuffer | null>(initialMasterKey);
let _symEncKey = $state<Uint8Array | null>(initialSymEncKey);
let _symMacKey = $state<Uint8Array | null>(initialSymMacKey);
const _organizationKeys = new Map<string, { encKey: Uint8Array; macKey: Uint8Array }>();

function persistDevKeys() {
	if (typeof window !== "undefined" && import.meta.env.DEV) {
		if (_masterKey && _symEncKey && _symMacKey) {
			sessionStorage.setItem(
				"dev_master_key",
				bytesToBase64(new Uint8Array(_masterKey)),
			);
			sessionStorage.setItem("dev_sym_enc_key", bytesToBase64(_symEncKey));
			sessionStorage.setItem("dev_sym_mac_key", bytesToBase64(_symMacKey));
		} else {
			sessionStorage.removeItem("dev_master_key");
			sessionStorage.removeItem("dev_sym_enc_key");
			sessionStorage.removeItem("dev_sym_mac_key");
		}
	}
}

let _vault = $state<VaultState>({
	ciphers: [],
	folders: [],
	collections: [],
	organizations: [],
	sends: [],
	profile: null,
	syncedAt: null,
	status: "idle",
	error: null,
	warning: null,
});

// ── Public reactive surface ───────────────────────────────────────────────────

/**
 * Read-only reactive view of the vault.
 * Access any property inside a Svelte component or effect to subscribe.
 */
export const vault = {
	get isUnlocked() {
		return _symEncKey !== null && _symMacKey !== null;
	},
	get ciphers() {
		return _vault.ciphers;
	},
	get folders() {
		return _vault.folders;
	},
	get collections() {
		return _vault.collections;
	},
	get organizations() {
		return _vault.organizations;
	},
	get sends() {
		return _vault.sends;
	},
	get profile() {
		return _vault.profile;
	},
	get syncedAt() {
		return _vault.syncedAt;
	},
	get status() {
		return _vault.status;
	},
	get error() {
		return _vault.error;
	},
	get warning() {
		return _vault.warning;
	},
	get isOffline() {
		return _vault.status === "offline";
	},
	get isSyncing() {
		return _vault.status === "syncing";
	},
	get symEncKey() {
		return _symEncKey;
	},
	get symMacKey() {
		return _symMacKey;
	},
};

export function getOrganizationKey(organizationId: string): { encKey: Uint8Array; macKey: Uint8Array } | null {
	const key = _organizationKeys.get(organizationId);
	return key ? { encKey: new Uint8Array(key.encKey), macKey: new Uint8Array(key.macKey) } : null;
}

// ── Private Key Setup & Decryption ──────────────────────────────────────────

async function setupUserKeys(profileKey: string): Promise<void> {
	if (!_masterKey) throw new Error("Vault is locked");

	const encKey = await hkdfExpand(new Uint8Array(_masterKey), "enc", 32);
	const macKey = await hkdfExpand(new Uint8Array(_masterKey), "mac", 32);
	const keyBytes = await decryptBw(profileKey, encKey, macKey);

	if (!keyBytes || keyBytes.length < 64) throw new Error("Invalid profile key");
	_symEncKey = keyBytes.slice(0, 32);
	_symMacKey = keyBytes.slice(32, 64);
	persistDevKeys();
}

async function decryptAllCiphers(
	ciphers: CipherResponse[],
): Promise<CipherResponse[]> {
	if (!_symEncKey || !_symMacKey) return ciphers;

	const decrypted: CipherResponse[] = [];
	let failures = 0;
	for (const cipher of ciphers) {
		try {
			const key = cipher.organizationId ? _organizationKeys.get(cipher.organizationId) : { encKey: _symEncKey, macKey: _symMacKey };
			if (!key) throw new Error("Organization key unavailable");
			const dec = await decryptCipher(cipher, key.encKey, key.macKey);
			decrypted.push(dec);
		} catch (e) {
			console.error("Failed to decrypt cipher:", cipher.id, e);
			failures++;
		}
	}
	if (failures) _vault.warning = `${failures} 个保险库条目未通过完整性校验，已从当前会话隔离。`;
	return decrypted;
}

async function setupOrganizationKeys(profile: SyncResponse["profile"]): Promise<void> {
	_organizationKeys.clear();
	const organizations = ((profile as any).organizations ?? []) as Record<string, any>[];
	if (!organizations.length) return;
	if (!_symEncKey || !_symMacKey || !profile.privateKey) throw new Error("Account private key unavailable");
	const privateKey = await importAccountPrivateKey(profile.privateKey, _symEncKey, _symMacKey);
	let failures = 0;
	for (const organization of organizations) {
		try {
			if (!organization.id || !organization.key) throw new Error("Missing member key");
			_organizationKeys.set(String(organization.id), await unwrapOrganizationKey(String(organization.key), privateKey));
		} catch (error) { console.error("Failed to unwrap organization key", organization.id, error); failures++; }
	}
	if (failures) _vault.warning = `${failures} 个组织密钥无法解封，相关条目已隔离。`;
}

async function decryptCollections(collections: unknown[]): Promise<Record<string, any>[]> {
	const output: Record<string, any>[] = [];
	for (const raw of collections) {
		const collection = raw as Record<string, any>;
		try {
			const key = _organizationKeys.get(String(collection.organizationId ?? ""));
			if (!key) throw new Error("Organization key unavailable");
			output.push({ ...collection, name: await decryptStr(String(collection.name ?? ""), key.encKey, key.macKey) });
		} catch (error) { console.error("Failed to decrypt collection", collection.id, error); }
	}
	return output;
}

export function applyOrganizationAccess(ciphers: CipherResponse[], collections: Record<string, any>[]): CipherResponse[] {
	const visible = new Map(collections.map((collection) => [String(collection.id), collection]));
	return ciphers.map((cipher) => {
		if (!cipher.organizationId) return cipher;
		const ids = cipher.collectionIds ?? [];
		const access = ids.map((id) => visible.get(id)).filter((collection): collection is Record<string, any> => Boolean(collection));
		const readOnly = !ids.length || access.length !== ids.length || access.some((collection) => Boolean(collection.readOnly));
		const hidePasswords = access.length > 0 && access.every((collection) => Boolean(collection.hidePasswords));
		return { ...cipher, readOnly, hidePasswords } as CipherResponse;
	});
}

async function decryptAllFolders(
	folders: FolderResponse[],
): Promise<FolderResponse[]> {
	if (!_symEncKey || !_symMacKey) return folders;

	const decrypted: FolderResponse[] = [];
	let failures = 0;
	for (const folder of folders) {
		try {
			const name = await decryptStr(folder.name, _symEncKey, _symMacKey);
			decrypted.push({ ...folder, name });
		} catch (e) {
			console.error("Failed to decrypt folder:", folder.id, e);
			failures++;
		}
	}
	if (failures) _vault.warning = `${_vault.warning ? `${_vault.warning} ` : ""}${failures} 个文件夹未通过完整性校验，已从当前会话隔离。`;
	return decrypted;
}

async function decryptAllSends(sends: unknown[]): Promise<Record<string, any>[]> {
	if (!_symEncKey || !_symMacKey) return [];
	const decrypted: Record<string, any>[] = [];
	let failures = 0;
	for (const send of sends) {
		try { decrypted.push(await decryptOwnedSend(send as Record<string, any>, _symEncKey, _symMacKey)); }
		catch (error) { console.error("Failed to decrypt Send:", error); failures++; }
	}
	if (failures) _vault.warning = `${_vault.warning ? `${_vault.warning} ` : ""}${failures} 个 Send 未通过完整性校验，已隔离。`;
	return decrypted;
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Pull vault from server; fall back to IndexedDB when offline.
 * Requires master key to already be set.
 */
export async function syncVaultData(): Promise<void> {
	_vault.status = "syncing";
	_vault.error = null;
	_vault.warning = null;

	try {
		const data = await syncVault();

		// Save the raw ENCRYPTED data to offline IndexedDB
		await saveVaultSnapshot({
			ciphers: data.ciphers,
			folders: data.folders,
			collections: data.collections,
			sends: data.sends as Record<string, unknown>[],
			profile: data.profile,
		});

		// Decrypt keys in memory
		if (!_symEncKey || !_symMacKey) await setupUserKeys(data.profile.key);
		await setupOrganizationKeys(data.profile);

		// Decrypt all ciphers in memory
		const decryptedCiphers = await decryptAllCiphers(data.ciphers);
		_vault.folders = await decryptAllFolders(data.folders);
		_vault.collections = await decryptCollections(data.collections);
		_vault.ciphers = applyOrganizationAccess(decryptedCiphers, _vault.collections);
		_vault.organizations = ((data.profile as any).organizations ?? []) as Record<string, any>[];
		_vault.sends = await decryptAllSends(data.sends);
		_vault.profile = data.profile;
		_vault.syncedAt = Date.now();
		_vault.status = "idle";
	} catch (e: any) {
		console.error("Sync error:", e);
		// Network unavailable — try the local cache
		const cached = await loadVaultSnapshot();
		if (cached) {
			try {
				// Initialize keys from cached snapshot
				await setupUserKeys(cached.profile.key);
				await setupOrganizationKeys(cached.profile);
				const decryptedCiphers = await decryptAllCiphers(cached.ciphers);
				_vault.folders = await decryptAllFolders(cached.folders);
				_vault.collections = await decryptCollections(cached.collections ?? []);
				_vault.ciphers = applyOrganizationAccess(decryptedCiphers, _vault.collections);
				_vault.organizations = (((cached.profile as any).organizations ?? []) as Record<string, any>[]);
				_vault.sends = await decryptAllSends(cached.sends ?? []);
				_vault.profile = cached.profile;
				_vault.syncedAt = cached.syncedAt;
				_vault.status = "offline";
			} catch (decErr) {
				_vault.status = "error";
				_vault.error = "本地缓存解密失败，可能密码已更改。";
				throw decErr;
			}
		} else {
			_vault.status = "error";
			_vault.error = "离线状态且无本地缓存，请先联网登录一次。";
			throw new Error(_vault.error);
		}
	}
}

/**
 * Derive master key from the user's master password and sync the vault.
 * KDF settings are read from the cached profile so this works offline.
 */
export async function unlock(password: string): Promise<void> {
	const cached = await loadVaultSnapshot();
	if (!cached) {
		throw new Error("无本地缓存，请联网登录后再使用离线功能。");
	}

	const { email, kdfIterations } = cached.profile;
	_masterKey = await deriveMasterKey(password, email, kdfIterations);

	// Setup local keys and perform decryption from cache first (so UI updates instantly)
	await setupUserKeys(cached.profile.key);
	await setupOrganizationKeys(cached.profile);
	const decryptedCiphers = await decryptAllCiphers(cached.ciphers);
	_vault.folders = await decryptAllFolders(cached.folders);
	_vault.collections = await decryptCollections(cached.collections ?? []);
	_vault.ciphers = applyOrganizationAccess(decryptedCiphers, _vault.collections);
	_vault.organizations = (((cached.profile as any).organizations ?? []) as Record<string, any>[]);
	_vault.sends = await decryptAllSends(cached.sends ?? []);
	_vault.profile = cached.profile;
	_vault.syncedAt = cached.syncedAt;

	// Attempt online sync in the background
	try {
		await syncVaultData();
	} catch (e) {
		console.warn(
			"Background sync failed during unlock, running in offline mode",
			e,
		);
	}
}

/**
 * Set master key directly (called after a fresh login/sync).
 */
export function setMasterKey(key: ArrayBuffer): void {
	_masterKey = key;
}

/** Set a user key recovered through a WebAuthn PRF credential. */
export function setSymmetricKeys(encKey: Uint8Array, macKey: Uint8Array): void {
	if (encKey.length !== 32 || macKey.length !== 32) throw new Error("Invalid vault key");
	_symEncKey = new Uint8Array(encKey);
	_symMacKey = new Uint8Array(macKey);
	persistDevKeys();
}

/**
 * Lock the vault: clear master key and in-memory data.
 * IndexedDB cache is kept for the next offline unlock.
 */
export function lock(): void {
	_masterKey = null;
	_symEncKey = null;
	_symMacKey = null;
	_organizationKeys.clear();
	persistDevKeys();
	_vault = {
		ciphers: [],
		folders: [],
		collections: [],
		organizations: [],
		sends: [],
		profile: null,
		syncedAt: null,
		status: "idle",
		error: null,
		warning: null,
	};
}

/**
 * Full logout: lock vault, clear IndexedDB cache, clear auth token.
 */
export async function logout(): Promise<void> {
	lock();
	await clearVaultSnapshot();
	await apiLogout();
}
