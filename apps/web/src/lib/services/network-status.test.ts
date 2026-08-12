import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkStatusMonitor } from "./network-status";

describe("network status monitor", () => {
	afterEach(() => vi.useRealTimers());
	it("distinguishes browser offline from an unreachable service", async () => {
		const statuses: string[] = [];
		const probe = vi.fn().mockRejectedValue(new Error("unreachable"));
		const monitor = new NetworkStatusMonitor({
			probe,
			onStatus: (status) => statuses.push(status),
		});
		await monitor.check(false);
		expect(probe).not.toHaveBeenCalled();
		await monitor.check(true);
		expect(statuses).toEqual(["offline", "offline"]);
	});

	it("periodically probes and can be stopped", async () => {
		vi.useFakeTimers();
		const statuses: string[] = [];
		const monitor = new NetworkStatusMonitor({
			probe: vi.fn().mockResolvedValue(true),
			onStatus: (status) => statuses.push(status),
			intervalMs: 1_000,
		});
		monitor.start();
		await vi.advanceTimersByTimeAsync(1_000);
		monitor.stop();
		expect(statuses).toContain("online");
		const count = statuses.length;
		await vi.advanceTimersByTimeAsync(2_000);
		expect(statuses).toHaveLength(count);
	});
});
