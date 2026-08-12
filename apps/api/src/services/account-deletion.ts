import type { D1Dialect } from "@sundoge/kysely-d1";
import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import { executeBatch } from "./db/batch";
import { now } from "../utils/time";

export interface AccountDeletionResult {
	ciphers: number;
	sends: number;
}

export async function deleteAccountData(
	db: Kysely<DB>,
	dialect: D1Dialect,
	userId: string,
): Promise<AccountDeletionResult | null> {
	const ownedOrganization = await db
		.selectFrom("organizations")
		.select("id")
		.where("owner_id", "=", userId)
		.executeTakeFirst();
	if (ownedOrganization) return null;
	const cipherCount = await db
		.selectFrom("ciphers")
		.select((expression) => expression.fn.countAll<number>().as("count"))
		.where("user_id", "=", userId)
		.executeTakeFirst();
	const sendCount = await db
		.selectFrom("sends")
		.select((expression) => expression.fn.countAll<number>().as("count"))
		.where("user_id", "=", userId)
		.executeTakeFirst();
	const timestamp = now();
	await executeBatch(dialect, [
		db
			.updateTable("users")
			.set({
				status: "banned",
				deletion_requested_at: timestamp,
				security_stamp: crypto.randomUUID(),
				updated_at: timestamp,
			})
			.where("id", "=", userId)
			.where("deletion_requested_at", "is", null)
			.compile(),
		db
			.updateTable("ciphers")
			.set({
				deleted_at: timestamp,
				purge_after: timestamp,
				updated_at: timestamp,
			})
			.where("user_id", "=", userId)
			.compile(),
		db
			.updateTable("sends")
			.set({ deletion_date: timestamp, updated_at: timestamp })
			.where("user_id", "=", userId)
			.compile(),
		db.deleteFrom("refresh_tokens").where("user_id", "=", userId).compile(),
		db.deleteFrom("org_members").where("user_id", "=", userId).compile(),
	]);
	return {
		ciphers: Number(cipherCount?.count ?? 0),
		sends: Number(sendCount?.count ?? 0),
	};
}
