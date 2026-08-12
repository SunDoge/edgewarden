import type { CompiledQuery, Kysely } from "kysely";
import type { DB } from "../../types/db";

export async function getConfigValue(
	db: Kysely<DB>,
	key: string,
): Promise<string | null> {
	const row = await db
		.selectFrom("config")
		.select("value")
		.where("key", "=", key)
		.executeTakeFirst();
	return row?.value ?? null;
}

export async function setConfigValue(
	db: Kysely<DB>,
	key: string,
	value: string,
): Promise<void> {
	await db.executeQuery(setConfigValueQuery(db, key, value));
}

export function setConfigValueQuery(
	db: Kysely<DB>,
	key: string,
	value: string,
): CompiledQuery {
	return db
		.insertInto("config")
		.values({ key, value })
		.onConflict((oc) => oc.column("key").doUpdateSet({ value }))
		.compile();
}

export async function deleteConfigValue(
	db: Kysely<DB>,
	key: string,
): Promise<void> {
	await db.deleteFrom("config").where("key", "=", key).execute();
}
