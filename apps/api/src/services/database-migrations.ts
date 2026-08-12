import { databaseMigrations } from "../generated/database-migrations";

// Match Wrangler's default ledger so runtime and explicit `wrangler d1
// migrations apply` operations are interoperable.
const MIGRATIONS_TABLE = "d1_migrations";
const initializationByDatabase = new WeakMap<D1Database, Promise<void>>();

/** Split SQLite statements without treating semicolons in strings or comments as delimiters. */
export function splitSqlStatements(source: string): string[] {
	const statements: string[] = [];
	let statement = "";
	let quote: "'" | '"' | "`" | "]" | null = null;
	let lineComment = false;
	let blockComment = false;

	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		const next = source[index + 1];

		if (lineComment) {
			if (char === "\n") {
				lineComment = false;
				statement += char;
			}
			continue;
		}
		if (blockComment) {
			if (char === "*" && next === "/") {
				blockComment = false;
				index += 1;
			}
			continue;
		}
		if (!quote && char === "-" && next === "-") {
			lineComment = true;
			index += 1;
			continue;
		}
		if (!quote && char === "/" && next === "*") {
			blockComment = true;
			index += 1;
			continue;
		}

		if (quote) {
			statement += char;
			if (quote === "]" ? char === "]" : char === quote) {
				if (quote !== "]" && next === quote) {
					statement += next;
					index += 1;
				} else {
					quote = null;
				}
			}
			continue;
		}

		if (char === "'" || char === '"' || char === "`") quote = char;
		else if (char === "[") quote = "]";
		if (char === ";") {
			if (statement.trim()) statements.push(statement.trim());
			statement = "";
		} else {
			statement += char;
		}
	}
	if (statement.trim()) statements.push(statement.trim());
	return statements;
}

async function applyPendingMigrations(database: D1Database): Promise<void> {
	await database
		.prepare(
			`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (` +
				"id INTEGER PRIMARY KEY AUTOINCREMENT, " +
				"name TEXT UNIQUE, " +
				"applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)",
		)
		.run();
	const applied = await database
		.prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`)
		.all<{ name: string }>();
	const appliedNames = new Set(applied.results.map(({ name }) => name));

	for (const migration of databaseMigrations) {
		if (appliedNames.has(migration.name)) continue;
		const statements = splitSqlStatements(migration.sql).filter(
			(statement) => !/^PRAGMA\s+foreign_keys\b/i.test(statement),
		);
		await database.batch([
			...statements.map((statement) => database.prepare(statement)),
			database
				.prepare(`INSERT OR IGNORE INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`)
				.bind(migration.name),
		]);
	}
}

export function ensureDatabaseSchema(database: D1Database): Promise<void> {
	const current = initializationByDatabase.get(database);
	if (current) return current;
	const initialization = applyPendingMigrations(database).catch((error) => {
		initializationByDatabase.delete(database);
		throw error;
	});
	initializationByDatabase.set(database, initialization);
	return initialization;
}
