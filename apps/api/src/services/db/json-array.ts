import { sql, type RawBuilder } from "kysely";

/**
 * Build a D1/SQLite membership predicate using one JSON-bound parameter.
 * Column names must be static server-owned identifiers, never user input.
 */
export function textColumnInJson(
  column: string,
  values: readonly string[],
): RawBuilder<boolean> {
  return sql<boolean>`${sql.ref(column)} in (
		select value from json_each(${JSON.stringify(values)})
	)`;
}
