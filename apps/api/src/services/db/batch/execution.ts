import type { D1Dialect } from "../d1-dialect";
import type { CompiledQuery } from "kysely";

// D1 limits batch size; chunking preserves order while keeping each request within the platform limit.
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
