import * as v from "valibot";

/** Parse a JSON trust boundary and validate its complete runtime shape. */
export function parseJsonWithSchema<
	TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(text: string, schema: TSchema): v.InferOutput<TSchema> {
	const decoded: unknown = JSON.parse(text);
	return v.parse(schema, decoded);
}

/** Return null for malformed JSON or data that does not match the schema. */
export function safeParseJsonWithSchema<
	TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(text: string, schema: TSchema): v.InferOutput<TSchema> | null {
	try {
		return parseJsonWithSchema(text, schema);
	} catch {
		return null;
	}
}
