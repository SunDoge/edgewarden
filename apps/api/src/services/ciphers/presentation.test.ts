import { describe, expect, it } from "vitest";
import { buildCipherData } from "./presentation";

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
