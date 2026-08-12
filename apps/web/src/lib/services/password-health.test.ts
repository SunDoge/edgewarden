import { describe, expect, it, vi } from "vitest";
import {
	checkPasswordHash,
	inspectPasswordHealth,
	isWeakPassword,
	parsePwnedRange,
	sha1Password,
} from "./password-health";

describe("password health", () => {
	it("uses SHA-1 k-anonymity and never sends the password", async () => {
		const hash = await sha1Password("password");
		expect(hash).toBe("5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
		let requestedUrl = "";
		const fetcher = vi.fn(async (url: string | URL | Request) => {
			requestedUrl = String(url);
			return new Response(`${hash.slice(5)}:42\n`);
		});
		expect(await checkPasswordHash(hash, fetcher as typeof fetch)).toBe(42);
		expect(requestedUrl).toBe(
			`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
		);
		expect(new URL(requestedUrl).pathname).toBe(`/range/${hash.slice(0, 5)}`);
		expect(new URL(requestedUrl).search).toBe("");
	});

	it("detects weak, reused, exposed and unavailable passwords", async () => {
		const fetcher = vi.fn(
			async (url: string | URL | Request) =>
				new Response(
					String(url).endsWith("5BAA6")
						? "1E4C9B93F3F0682250B6CF8331B7EE68FD8:100\n"
						: "",
					{ status: 200 },
				),
		);
		const report = await inspectPasswordHealth(
			[
				{ id: "a", type: 1, login: { password: "password", username: "a" } },
				{ id: "b", type: 1, login: { password: "password", username: "b" } },
			] as any,
			fetcher as typeof fetch,
		);
		expect(report).toMatchObject({
			eligibleCount: 2,
			exposedCount: 2,
			reusedCount: 2,
			weakCount: 2,
			unavailableCount: 0,
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("parses padded range responses and applies local weakness rules", () => {
		expect(parsePwnedRange("AAAA:0\nBBBB:9", "BBBB")).toBe(9);
		expect(isWeakPassword("alice123", "alice@example.com")).toBe(true);
		expect(isWeakPassword("long-And-Random-Secret-2026", "alice")).toBe(false);
	});

	it("reports progress and excludes organization entries whose passwords must stay hidden", async () => {
		const progress: Array<[number, number]> = [];
		const report = await inspectPasswordHealth(
			[
				{ id: "visible", type: 1, login: { password: "password" } },
				{
					id: "hidden",
					type: 1,
					login: { password: "password" },
					hidePasswords: true,
				},
			] as any,
			async () => new Response("1E4C9B93F3F0682250B6CF8331B7EE68FD8:1"),
			undefined,
			(checked, total) => progress.push([checked, total]),
		);
		expect(report.eligibleCount).toBe(1);
		expect(progress.at(-1)).toEqual([1, 1]);
	});
});
