import { describe, expect, it } from "vitest";
import { credentialMatches, parseUuid } from "./policy";

describe("credentials", () => {
	it("parses and compares UUIDs", () => {
		const uuid = parseUuid("10982a88-05a9-4c5d-9142-0f618b07c94a");
		expect(uuid).not.toBeNull();
		expect(
			credentialMatches(uuid as Uint8Array, {
				id: "user",
				uuid: Uint8Array.from(uuid as Uint8Array),
				enabled: true,
			}),
		).toBe(true);
	});

	it("rejects invalid and disabled credentials", () => {
		expect(parseUuid("not-a-uuid")).toBeNull();
		const uuid = parseUuid(
			"10982a88-05a9-4c5d-9142-0f618b07c94a",
		) as Uint8Array;
		expect(credentialMatches(uuid, { id: "user", uuid, enabled: false })).toBe(
			false,
		);
	});
});
