import { describe, expect, it } from "vitest";
import { CipherType } from "@edgewarden/shared";
import { buildCipherPayload, type CipherDraft } from "./cipher-draft";

function draft(overrides: Partial<CipherDraft> = {}): CipherDraft {
	return {
		type: CipherType.Login,
		name: " Site ",
		notes: "",
		favorite: false,
		folderId: null,
		login: {
			username: "alice",
			password: "new",
			uri: "",
			uris: [{ uri: " https://example.com ", match: 1 }],
			totp: "",
		},
		card: { cardholderName: "", number: "" },
		identity: { firstName: "", lastName: "", number: "" },
		customFields: [],
		extraData: "{}",
		...overrides,
	};
}

describe("cipher draft payload", () => {
	it("preserves compatibility login fields and records changed passwords", () => {
		const payload = buildCipherPayload(
			draft(),
			{
				key: "wrapped",
				login: { password: "old", unknown: "keep" },
				passwordHistory: [],
			},
			true,
			new Date("2026-01-02T00:00:00Z"),
		);
		expect(payload.login).toMatchObject({
			username: "alice",
			password: "new",
			unknown: "keep",
			uris: [{ uri: "https://example.com", match: 1 }],
		});
		expect(payload.passwordHistory?.[0]).toEqual({
			password: "old",
			lastUsedDate: "2026-01-02T00:00:00.000Z",
		});
		expect(payload.key).toBe("wrapped");
	});

	it("merges structured extra data and rejects malformed JSON", () => {
		const payload = buildCipherPayload(
			draft({ type: CipherType.SshKey, extraData: '{"privateKey":"secret"}' }),
			{ sshKey: { publicKey: "keep" } },
			true,
		);
		expect(payload.sshKey).toEqual({ publicKey: "keep", privateKey: "secret" });
		expect(() =>
			buildCipherPayload(
				draft({ type: CipherType.Passport, extraData: "{" }),
				null,
				false,
			),
		).toThrow(/有效的 JSON/);
	});

	it("normalizes custom fields and secure-note metadata", () => {
		const payload = buildCipherPayload(
			draft({
				type: CipherType.SecureNote,
				customFields: [
					{ name: " token ", value: "x", type: 1 },
					{ name: "", value: "drop", type: 0 },
				],
			}),
			{ secureNote: { type: 0, unknown: true } },
			true,
		);
		expect(payload.secureNote).toEqual({ type: 0, unknown: true });
		expect(payload.fields).toEqual([{ name: "token", value: "x", type: 1 }]);
	});
});
