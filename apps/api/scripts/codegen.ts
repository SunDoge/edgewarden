/**
 * Apply migrations to an isolated in-memory SQLite database and generate
 * Kysely types from the resulting schema.
 */
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Kysely, SqliteDialect as KyselySqliteDialect } from "kysely";
import {
  generate,
  SqliteDialect as CodegenSqliteDialect,
} from "kysely-codegen";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDirectory, "..");
// Schema introspection needs no persistent state. Each invocation owns its
// connection, so it cannot delete or reuse another invocation's database.
const rawDatabase = new Database(":memory:");
const database = new Kysely({
  dialect: new KyselySqliteDialect({ database: rawDatabase }),
});
try {
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

  const outputPath = resolve(apiRoot, "src/types/db.d.ts");
  const generated = await generate({
    db: database,
    dialect: new CodegenSqliteDialect(),
    outFile: null,
  });
  const formatted = execFileSync(
    "pnpm",
    ["exec", "biome", "format", `--stdin-file-path=${outputPath}`],
    { cwd: apiRoot, input: generated, encoding: "utf8" },
  );
  if (process.argv.includes("--check")) {
    if (readFileSync(outputPath, "utf8") !== formatted) {
      throw new Error(
        "Database types are stale. Run pnpm --filter @edgewarden/api db:codegen",
      );
    }
    console.log("✓ Database types match migrations");
  } else {
    writeFileSync(outputPath, formatted);
    console.log("✓ src/types/db.d.ts generated");
  }
} finally {
  await database.destroy();
  // Migrations may fail before Kysely has acquired the lazy connection.
  if (rawDatabase.open) rawDatabase.close();
}
