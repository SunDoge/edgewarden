import {
	D1Dialect as KyselyD1Dialect,
	prepareStatement,
} from "@sundoge/kysely-d1";
import type { CompiledQuery, QueryResult } from "kysely";

type QueryOutput<Query> =
	Query extends CompiledQuery<infer Output> ? Output : never;

type CompiledBatchResult<Queries extends readonly CompiledQuery[]> = {
	-readonly [Index in keyof Queries]: QueryResult<QueryOutput<Queries[Index]>>;
};

/**
 * Edgewarden builds reusable batches from compiled queries. The upstream 0.3
 * helper accepts query builders instead, so keep this small adapter at the D1
 * boundary rather than coupling handlers to the binding API.
 */
export class D1Dialect extends KyselyD1Dialect {
	readonly #database: D1Database;

	constructor(database: D1Database) {
		super({ database });
		this.#database = database;
	}

	async batch<const Queries extends readonly CompiledQuery[]>(
		queries: Queries,
	): Promise<CompiledBatchResult<Queries>> {
		if (queries.length === 0) {
			return [] as unknown as CompiledBatchResult<Queries>;
		}
		const statements = queries.map((query) =>
			prepareStatement(this.#database, query),
		);
		const results = await this.#database.batch<unknown>(statements);
		return results.map((result) => ({
			rows: result.results ?? [],
			numAffectedRows:
				result.meta?.changes == null ? undefined : BigInt(result.meta.changes),
			insertId:
				result.meta?.last_row_id == null
					? undefined
					: BigInt(result.meta.last_row_id),
		})) as unknown as CompiledBatchResult<Queries>;
	}
}
