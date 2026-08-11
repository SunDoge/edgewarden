import type { D1Dialect } from "@sundoge/kysely-d1";
import type { CompiledQuery, Kysely } from "kysely";
import type { DB } from "../../types/db";
import { now } from "../../utils/time";

export function revisionQuery(db: Kysely<DB>, userId: string, timestamp = now()) {
	return db
		.insertInto("user_revisions")
		.values({ user_id: userId, revision_date: timestamp })
		.onConflict((oc) =>
			oc.column("user_id").doUpdateSet({ revision_date: timestamp }),
		)
		.compile();
}

export async function executeBatch(
	dialect: D1Dialect,
	queries: readonly CompiledQuery[],
): Promise<void> {
	if (queries.length === 0) return;
	await dialect.batch([...queries]);
}

export async function executeBatchInChunks(
	dialect: D1Dialect,
	queries: readonly CompiledQuery[],
	chunkSize: number,
): Promise<void> {
	if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
		throw new RangeError("chunkSize must be a positive integer");
	}
	for (let index = 0; index < queries.length; index += chunkSize) {
		await executeBatch(dialect, queries.slice(index, index + chunkSize));
	}
}
