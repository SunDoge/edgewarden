import { describe, expect, it } from "vitest";
import { applyOrganizationAccess } from "./vault.svelte";

function cipher(collectionIds: string[]) {
	return { id: "cipher", organizationId: "org", collectionIds } as any;
}

describe("organization cipher client restrictions", () => {
	it("marks a cipher read-only when any linked collection is hidden or read-only", () => {
		const [restricted] = applyOrganizationAccess(
			[cipher(["visible", "hidden"])],
			[
				{
					id: "visible",
					organizationId: "org",
					readOnly: false,
					hidePasswords: false,
				},
			],
		);
		expect((restricted as any).readOnly).toBe(true);

		const [readOnly] = applyOrganizationAccess(
			[cipher(["visible"])],
			[
				{
					id: "visible",
					organizationId: "org",
					readOnly: true,
					hidePasswords: false,
				},
			],
		);
		expect((readOnly as any).readOnly).toBe(true);
	});

	it("only hides passwords when every visible collection requires it", () => {
		const [hidden] = applyOrganizationAccess(
			[cipher(["first", "second"])],
			[
				{ id: "first", hidePasswords: true },
				{ id: "second", hidePasswords: true },
			],
		);
		expect((hidden as any).hidePasswords).toBe(true);

		const [visible] = applyOrganizationAccess(
			[cipher(["first", "second"])],
			[
				{ id: "first", hidePasswords: true },
				{ id: "second", hidePasswords: false },
			],
		);
		expect((visible as any).hidePasswords).toBe(false);
	});
});
