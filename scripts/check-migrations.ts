import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const directory = new URL("../apps/api/migrations/", import.meta.url);
const files = (await readdir(directory))
	.filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
	.sort();

assert.ok(files.length > 0, "At least one D1 migration is required");
for (const [index, file] of files.entries()) {
	const expected = String(index + 1).padStart(4, "0");
	assert.equal(
		file.slice(0, 4),
		expected,
		`D1 migrations must be contiguous; expected ${expected}, found ${file}`,
	);
	const sql = await readFile(new URL(file, directory), "utf8");
	if (index === 0) continue;

	// The deploy order is bundle preflight -> migrations -> Worker upload. Every
	// post-init migration must therefore remain compatible with the currently
	// deployed Worker until the new Worker version becomes active.
	const destructive = sql.match(
		/\b(?:DROP\s+(?:TABLE|COLUMN)|ALTER\s+TABLE\s+\S+\s+RENAME|DELETE\s+FROM\s+(?!d1_migrations\b)|TRUNCATE)\b/i,
	);
	assert.equal(
		destructive,
		null,
		`${file} contains a destructive migration (${destructive?.[0]}). Use an expand/backfill/contract release sequence instead.`,
	);
}

console.log(
	`Validated ${files.length} ordered, backward-compatible D1 migrations.`,
);
