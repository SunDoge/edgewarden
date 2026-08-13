import { describe, expect, it } from "vitest";
import type { Selectable } from "kysely";
import type { Ciphers } from "../../types/db";
import { buildCipherData, cipherToResponse } from "./presentation";

describe("buildCipherData", () => {
	it("preserves future client fields while excluding server-managed fields", () => {
		expect(
			JSON.parse(
				buildCipherData({
					id: "server-id",
					name: "encrypted-name",
					login: { username: "encrypted-user" },
					futureClientField: { encrypted: true },
				}),
			),
		).toEqual({
			login: { username: "encrypted-user" },
			futureClientField: { encrypted: true },
		});
	});

	it("drops undefined extension values", () => {
		expect(JSON.parse(buildCipherData({ custom: undefined }))).toEqual({});
	});
});

describe("cipherToResponse", () => {
	function loginCipher(login: Record<string, unknown>): Selectable<Ciphers> {
		return {
			archived_at: null,
			created_at: 1_700_000_000,
			data: JSON.stringify({ login }),
			deleted_at: null,
			favorite: 0,
			fields: null,
			folder_id: null,
			id: "cipher-id",
			key: "2.wrapped",
			mutation_token: null,
			name: "2.name",
			notes: null,
			org_id: null,
			password_history: null,
			purge_after: null,
			purge_token: null,
			reprompt: 0,
			type: 1,
			updated_at: 1_700_000_000,
			user_id: "user-id",
		};
	}

	it("adds Bitwarden's legacy login uri alias", () => {
		const response = cipherToResponse(
			loginCipher({
				username: "2.user",
				uris: [{ uri: "2.example", match: "1" }],
			}),
		);

		expect(response.login).toMatchObject({
			uri: "2.example",
			uris: [{ uri: "2.example", match: 1 }],
		});
	});

	it("normalizes client enums that must remain numeric", () => {
		const login = cipherToResponse(
			loginCipher({
				uris: [
					{ uri: "2.first", match: "1" },
					{ uri: "2.second", match: "2.encrypted-enum" },
				],
			}),
		);
		expect(login.login).toMatchObject({
			uris: [{ match: 1 }, { match: null }],
		});

		const secureNote = loginCipher({});
		secureNote.type = 2;
		secureNote.data = JSON.stringify({ secureNote: { type: "2.encrypted" } });
		secureNote.fields = JSON.stringify([
			{ name: "2.name", value: "2.value", type: "2.encrypted" },
		]);
		const response = cipherToResponse(secureNote);
		expect(response.secureNote).toEqual({ type: 0 });
		expect(response.fields).toEqual([
			{ name: "2.name", value: "2.value", type: 1 },
		]);
	});

	it("returns an empty login object with a null uri alias", () => {
		const response = cipherToResponse(loginCipher({ uris: [] }));

		expect(response.login).toEqual({
			uris: [],
			uri: null,
			passwordRevisionDate: null,
		});
	});

	it("repairs metadata dates encrypted by legacy web imports", () => {
		const cipher = loginCipher({
			passwordRevisionDate: "2.encrypted-date",
			fido2Credentials: [
				{ credentialId: "2.credential", creationDate: "2.encrypted-date" },
			],
		});
		cipher.password_history = JSON.stringify([
			{ password: "2.old-password", lastUsedDate: "2.encrypted-date" },
		]);

		const response = cipherToResponse(cipher);

		expect(response.login).toMatchObject({
			passwordRevisionDate: null,
			fido2Credentials: [
				{ credentialId: "2.credential", creationDate: EPOCH_ISO_FOR_TEST },
			],
		});
		expect(response.passwordHistory).toEqual([
			{ password: "2.old-password", lastUsedDate: EPOCH_ISO_FOR_TEST },
		]);
	});
});

const EPOCH_ISO_FOR_TEST = "1970-01-01T00:00:00.000Z";
