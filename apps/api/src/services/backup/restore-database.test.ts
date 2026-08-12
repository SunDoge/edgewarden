import { describe, expect, it } from "vitest";
import { buildShadowTableCreateSql } from "./restore-database";

describe("buildShadowTableCreateSql", () => {
	it("renames the restored table and its backup foreign keys", () => {
		const sql = buildShadowTableCreateSql(
			`CREATE TABLE ciphers (
				id TEXT PRIMARY KEY NOT NULL,
				folder_id TEXT,
				FOREIGN KEY (folder_id) REFERENCES folders(id)
			)`,
			"ciphers",
		);

		expect(sql).toContain('CREATE TABLE "ciphers__restore"');
		expect(sql).toContain('REFERENCES "folders__restore"(id)');
	});

	it("supports quoted table names and IF NOT EXISTS", () => {
		const sql = buildShadowTableCreateSql(
			'CREATE TABLE IF NOT EXISTS "users" (id TEXT PRIMARY KEY NOT NULL)',
			"users",
		);

		expect(sql).toBe(
			'CREATE TABLE "users__restore" (id TEXT PRIMARY KEY NOT NULL)',
		);
	});

	it("rejects a schema for a different table", () => {
		expect(() =>
			buildShadowTableCreateSql(
				"CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL)",
				"ciphers",
			),
		).toThrow("could not rewrite CREATE TABLE statement for ciphers");
	});
});
