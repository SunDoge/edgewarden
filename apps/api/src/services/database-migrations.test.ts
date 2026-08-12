import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { splitSqlStatements } from "./database-migrations";

describe("runtime database migrations", () => {
	test("does not split quoted semicolons and strips SQL comments", () => {
		assert.deepEqual(
			splitSqlStatements(`
				-- a semicolon here is not a statement;
				CREATE TABLE example (value TEXT DEFAULT ';');
				/* neither is this ; */ INSERT INTO example VALUES ('it''s;safe');
			`),
			[
				"CREATE TABLE example (value TEXT DEFAULT ';')",
				"INSERT INTO example VALUES ('it''s;safe')",
			],
		);
	});
});
