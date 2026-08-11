import Dexie, { type EntityTable } from "dexie";
import type {
	CipherResponse,
	CollectionResponse,
	FolderResponse,
	SyncResponse,
} from "@edgewarden/shared";

// ── Schema ────────────────────────────────────────────────────────────────────

/** Single-row snapshot of the last successful server sync */
export interface VaultSnapshot {
	/** Server-side account id; snapshots can never overwrite another account. */
	accountId: string;
	ciphers: CipherResponse[];
	folders: FolderResponse[];
	collections: CollectionResponse[];
	sends: Record<string, unknown>[];
	profile: SyncResponse["profile"];
	/** Unix ms of the last successful sync */
	syncedAt: number;
}

// ── Database ──────────────────────────────────────────────────────────────────

class EdgewardenDb extends Dexie {
	vaultByAccount!: EntityTable<VaultSnapshot, "accountId">;
	meta!: EntityTable<{ key: string; value: string }, "key">;

	constructor() {
		super("edgewarden");
		this.version(1).stores({
			vault: "&id", // unique, single row
		});
		this.version(2).stores({
			vault: "&id",
			vaultByAccount: "&accountId,syncedAt",
			meta: "&key",
		}).upgrade(async (transaction) => {
			const legacy = await transaction.table("vault").get(1) as (Omit<VaultSnapshot, "accountId" | "sends"> & { id: 1 }) | undefined;
			if (legacy?.profile?.id) {
				const snapshot: VaultSnapshot = { accountId: legacy.profile.id, ciphers: legacy.ciphers, folders: legacy.folders, collections: [], sends: [], profile: legacy.profile, syncedAt: legacy.syncedAt };
				await transaction.table("vaultByAccount").put(snapshot);
				await transaction.table("meta").put({ key: "activeAccountId", value: snapshot.accountId });
			}
			await transaction.table("vault").clear();
		});
		this.version(3).stores({
			vault: "&id",
			vaultByAccount: "&accountId,syncedAt",
			meta: "&key",
		}).upgrade(async (transaction) => {
			await transaction.table("vaultByAccount").toCollection().modify((snapshot: VaultSnapshot) => {
				snapshot.collections ??= [];
			});
		});
	}
}

export const db = new EdgewardenDb();

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function saveVaultSnapshot(
	data: Omit<VaultSnapshot, "accountId" | "syncedAt">,
): Promise<void> {
	const accountId = data.profile.id;
	await db.transaction("rw", db.vaultByAccount, db.meta, async () => {
		await db.vaultByAccount.put({ accountId, ...data, syncedAt: Date.now() });
		await db.meta.put({ key: "activeAccountId", value: accountId });
	});
}

export async function loadVaultSnapshot(): Promise<VaultSnapshot | undefined> {
	const active = await db.meta.get("activeAccountId");
	return active ? db.vaultByAccount.get(active.value) : undefined;
}

export async function clearVaultSnapshot(): Promise<void> {
	const legacyVault = db.table("vault");
	await db.transaction("rw", db.vaultByAccount, db.meta, legacyVault, async () => {
		await db.vaultByAccount.clear();
		await db.meta.clear();
		await legacyVault.clear();
	});
}
