/**
 * Codegen script: apply migrations to a temporary SQLite database, generate
 * Kysely types from the resulting schema, then remove the database.
 */
import Database from "better-sqlite3";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Kysely, SqliteDialect as KyselySqliteDialect } from "kysely";
import {
  generate,
  SqliteDialect as CodegenSqliteDialect,
} from "kysely-codegen";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDirectory, "..");
const temporaryDatabase = resolve(scriptDirectory, "__codegen_tmp.sqlite");

if (existsSync(temporaryDatabase)) unlinkSync(temporaryDatabase);

const rawDatabase = new Database(temporaryDatabase);
const migrationFiles = readdirSync(resolve(apiRoot, "migrations"))
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort();

for (const file of migrationFiles) {
  const sql = readFileSync(
    resolve(apiRoot, "migrations", file),
    "utf8",
  ).replace(/^PRAGMA.*/gm, "");
  rawDatabase.exec(sql);
}
console.log(`✓ ${migrationFiles.length} migrations applied to temp db`);

const database = new Kysely({
  dialect: new KyselySqliteDialect({ database: rawDatabase }),
});

await generate({
  db: database,
  dialect: new CodegenSqliteDialect(),
  outFile: resolve(apiRoot, "src/types/db.d.ts"),
});
console.log("✓ src/types/db.d.ts generated");

await database.destroy();
unlinkSync(temporaryDatabase);
console.log("✓ Temp db removed");
