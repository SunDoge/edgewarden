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

	it("returns an empty login object with a null uri alias", () => {
		const response = cipherToResponse(loginCipher({ uris: [] }));

		expect(response.login).toEqual({ uris: [], uri: null });
	});
});
