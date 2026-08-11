import assert from "node:assert";
import { describe, test } from "vitest";
import { now, toIso } from "./time";

describe("time utils", () => {
	test("now() returns current Unix seconds", () => {
		const start = Math.floor(Date.now() / 1000);
		const current = now();
		const end = Math.floor(Date.now() / 1000);

		assert.ok(current >= start);
		assert.ok(current <= end);
	});

	test("toIso() converts Unix seconds to ISO 8601 string", () => {
		const unix = 1719187200; // 2024-06-24T00:00:00.000Z
		const expected = "2024-06-24T00:00:00.000Z";
		assert.strictEqual(toIso(unix), expected);
	});
});
