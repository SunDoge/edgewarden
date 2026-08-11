import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearVaultSnapshot, db, loadVaultSnapshot, saveVaultSnapshot } from "./vault-db";

function snapshot(accountId: string) {
	return {
		profile: { id: accountId, email: `${accountId}@example.com`, key: "2.encrypted-profile-key", kdfIterations: 600_000 } as any,
		ciphers: [{ id: `${accountId}-cipher`, name: "2.encrypted-cipher-name" }] as any,
		folders: [{ id: `${accountId}-folder`, name: "2.encrypted-folder-name" }] as any,
		collections: [{ id: `${accountId}-collection`, organizationId: `${accountId}-org`, name: "2.encrypted-collection-name", readOnly: false, hidePasswords: false, creationDate: "2026-01-01T00:00:00Z", revisionDate: "2026-01-01T00:00:00Z", object: "collectionDetails" as const }],
		sends: [{ id: `${accountId}-send`, name: "2.encrypted-send-name", key: "2.encrypted-send-key" }],
	};
}

describe("encrypted vault cache", () => {
	beforeEach(async () => { await db.delete(); await db.open(); });
	afterEach(async () => { await db.delete(); });

	it("isolates snapshots by account while loading the active account", async () => {
		await saveVaultSnapshot(snapshot("first"));
		await saveVaultSnapshot(snapshot("second"));
		expect(await db.vaultByAccount.count()).toBe(2);
		const active = await loadVaultSnapshot();
		expect(active?.accountId).toBe("second");
		expect(active?.ciphers[0]?.name).toBe("2.encrypted-cipher-name");
		expect(active?.sends[0]?.name).toBe("2.encrypted-send-name");
	});

	it("removes every account snapshot on full logout", async () => {
		await saveVaultSnapshot(snapshot("first"));
		await saveVaultSnapshot(snapshot("second"));
		await db.table("vault").put({ id: 1, ...snapshot("legacy"), syncedAt: 1 });
		await clearVaultSnapshot();
		expect(await db.vaultByAccount.count()).toBe(0);
		expect(await db.table("vault").count()).toBe(0);
		expect(await loadVaultSnapshot()).toBeUndefined();
	});
});
