/**
 * Codegen script: apply migration to a temp SQLite, run kysely-codegen, clean up.
 */
import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-worker/normal";
import {
	generate,
	SqliteDialect as CodegenSqliteDialect,
} from "kysely-codegen";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, "..");
const tmpDb = resolve(__dir, "__codegen_tmp.sqlite");

// Clean up any leftover temp db
if (existsSync(tmpDb)) unlinkSync(tmpDb);

const rawDb = new Database(tmpDb);
const migrationFiles = readdirSync(resolve(root, "migrations"))
	.filter((file) => /^\d+.*\.sql$/.test(file))
	.sort();
for (const file of migrationFiles) {
	const sql = readFileSync(resolve(root, "migrations", file), "utf8").replace(/^PRAGMA.*/gm, "");
	rawDb.exec(sql);
}
rawDb.close();
console.log(`✓ ${migrationFiles.length} migrations applied to temp db`);

// 2. Open a fresh Bun-native Kysely connection for introspection.
const kyselyDb = new Kysely({
	dialect: new BunSqliteDialect({ url: tmpDb }),
});

const dialect = new CodegenSqliteDialect();
await generate({
	db: kyselyDb,
	dialect,
	outFile: resolve(root, "src/types/db.d.ts"),
});
console.log("✓ src/types/db.d.ts generated");

// 3. Clean up
await kyselyDb.destroy();
unlinkSync(tmpDb);
console.log("✓ Temp db removed");
