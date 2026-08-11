import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import { now, toIso } from "../../utils/time";

export async function getRevisionDate(
	db: Kysely<DB>,
	userId: string,
): Promise<string> {
	const row = await db
		.selectFrom("user_revisions")
		.select("revision_date")
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return row ? toIso(row.revision_date) : new Date(0).toISOString();
}

export async function touchRevision(
	db: Kysely<DB>,
	userId: string,
): Promise<void> {
	await db
		.insertInto("user_revisions")
		.values({ user_id: userId, revision_date: now() })
		.onConflict((oc) =>
			oc.column("user_id").doUpdateSet({ revision_date: now() }),
		)
		.execute();
}
