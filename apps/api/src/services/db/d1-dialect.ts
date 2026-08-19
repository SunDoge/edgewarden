import {
  batch,
  type BatchQuery,
  D1Dialect as KyselyD1Dialect,
} from "@sundoge/kysely-d1";
import type { CompiledQuery, QueryResult } from "kysely";

export type EdgewardenBatchQuery = BatchQuery | CompiledQuery;

type QueryOutput<Query> =
  Query extends BatchQuery<infer Output>
    ? Output
    : Query extends CompiledQuery<infer Output>
      ? Output
      : never;

type EdgewardenBatchResult<Queries extends readonly EdgewardenBatchQuery[]> = {
  -readonly [Index in keyof Queries]: QueryResult<QueryOutput<Queries[Index]>>;
};

function isCompiledQuery(query: EdgewardenBatchQuery): query is CompiledQuery {
  return "sql" in query && "parameters" in query;
}

/**
 * Bind the standalone upstream batch helper to the request's D1 database.
 * Standard queries stay as builders; only Kysely raw SQL, which requires an
 * executor to compile, may arrive in its already-compiled representation.
 */
export class D1Dialect extends KyselyD1Dialect {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    super({ database });
    this.#database = database;
  }

  async batch<const Queries extends readonly EdgewardenBatchQuery[]>(
    queries: Queries,
  ): Promise<EdgewardenBatchResult<Queries>> {
    const builders = queries.map((query) =>
      isCompiledQuery(query)
        ? {
            compile: () => query,
            execute: async () => [],
          }
        : query,
    );
    return batch(this.#database, builders) as unknown as Promise<
      EdgewardenBatchResult<Queries>
    >;
  }
}
