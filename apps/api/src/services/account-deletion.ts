import type { D1Dialect } from "@sundoge/kysely-d1";
import type { Kysely } from "kysely";
import type { DB } from "../types/db";
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
	const timestamp = now();
	const deletionToken = crypto.randomUUID();
	const ownsDeletion = db
		.selectFrom("users")
		.select("id")
		.where("id", "=", userId)
		.where("security_stamp", "=", deletionToken)
		.where("deletion_requested_at", "=", timestamp);
	const [deletedUser, deletedCiphers, deletedSends] = await dialect.batch([
		db
			.updateTable("users")
			.set({
				status: "banned",
				deletion_requested_at: timestamp,
				security_stamp: deletionToken,
				updated_at: timestamp,
			})
			.where("id", "=", userId)
			.where("deletion_requested_at", "is", null)
			.where(({ not, exists, selectFrom }) =>
				not(
					exists(
						selectFrom("organizations")
							.select("id")
							.where("owner_id", "=", userId),
					),
				),
			)
			.compile(),
		db
			.updateTable("ciphers")
			.set({
				deleted_at: timestamp,
				purge_after: timestamp,
				updated_at: timestamp,
			})
			.where("user_id", "=", userId)
			.where(({ exists }) => exists(ownsDeletion))
			.compile(),
		db
			.updateTable("sends")
			.set({ deletion_date: timestamp, updated_at: timestamp })
			.where("user_id", "=", userId)
			.where(({ exists }) => exists(ownsDeletion))
			.compile(),
		db
			.deleteFrom("refresh_tokens")
			.where("user_id", "=", userId)
			.where(({ exists }) => exists(ownsDeletion))
			.compile(),
		db
			.deleteFrom("org_members")
			.where("user_id", "=", userId)
			.where(({ exists }) => exists(ownsDeletion))
			.compile(),
	]);
	if (deletedUser.numAffectedRows !== 1n) return null;
	return {
		ciphers: Number(deletedCiphers.numAffectedRows ?? 0n),
		sends: Number(deletedSends.numAffectedRows ?? 0n),
	};
}
