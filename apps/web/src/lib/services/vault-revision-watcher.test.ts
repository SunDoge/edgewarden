import { describe, expect, it, vi } from "vitest";
import { VaultRevisionWatcher } from "./vault-revision-watcher";

describe("vault revision watcher", () => {
	it("uses the first revision as a baseline and refreshes only after change", async () => {
		const revisions = [10, 10, 11, 11];
		const changed = vi.fn();
		const watcher = new VaultRevisionWatcher({ readRevision: async () => revisions.shift() ?? 11, onRevision: changed });
		await watcher.check();
		await watcher.check();
		await watcher.check();
		await watcher.check();
		expect(changed).toHaveBeenCalledTimes(1);
		expect(changed).toHaveBeenCalledWith(11);
	});

	it("recovers after a network failure without emitting a false change", async () => {
		let calls = 0;
		const changed = vi.fn();
		const watcher = new VaultRevisionWatcher({ readRevision: async () => { calls++; if (calls === 1) throw new Error("offline"); return calls === 2 ? 5 : 6; }, onRevision: changed });
		await watcher.check();
		await watcher.check();
		await watcher.check();
		expect(changed).toHaveBeenCalledOnce();
	});
});
