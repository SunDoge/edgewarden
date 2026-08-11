import type { Kysely } from "kysely";
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
	// Use insert with onConflict update
	await db
		.insertInto("config")
		.values({ key, value })
		.onConflict((oc) => oc.column("key").doUpdateSet({ value }))
		.execute();
}

export async function deleteConfigValue(
	db: Kysely<DB>,
	key: string,
): Promise<void> {
	await db.deleteFrom("config").where("key", "=", key).execute();
}
