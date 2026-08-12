import type { D1Dialect } from "@sundoge/kysely-d1";
import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { HonoEnv } from "../env";
import { executeBatch } from "./db/batch";
import * as attachmentsDb from "./db/attachments";
import {
	deleteBlobObject,
	getAttachmentObjectKey,
	getSendFileObjectKey,
} from "./blob-store";

export interface AccountDeletionResult {
	attachments: number;
	sends: number;
}

export async function deleteAccountData(
	db: Kysely<DB>,
	dialect: D1Dialect,
	env: HonoEnv["Bindings"],
	userId: string,
): Promise<AccountDeletionResult | null> {
	const ownedOrganization = await db
		.selectFrom("organizations")
		.select("id")
		.where("owner_id", "=", userId)
		.executeTakeFirst();
	if (ownedOrganization) return null;
	const cipherIds = (
		await db
			.selectFrom("ciphers")
			.select("id")
			.where("user_id", "=", userId)
			.execute()
	).map((cipher) => cipher.id);
	const attachments = await attachmentsDb.listByCipherIds(db, cipherIds);
	const fileSends = await db
		.selectFrom("sends")
		.select(["id", "data"])
		.where("user_id", "=", userId)
		.where("type", "=", 1)
		.execute();
	const sendObjects = fileSends.flatMap((send) => {
		try {
			const fileId = (JSON.parse(send.data) as { id?: unknown }).id;
			return typeof fileId === "string" && fileId
				? [getSendFileObjectKey(send.id, fileId)]
				: [];
		} catch {
			return [];
		}
	});
	await executeBatch(dialect, [
		db.deleteFrom("org_members").where("user_id", "=", userId).compile(),
		db.deleteFrom("users").where("id", "=", userId).compile(),
	]);
	await Promise.allSettled([
		...attachments.map((attachment) =>
			deleteBlobObject(
				env,
				getAttachmentObjectKey(attachment.cipher_id, attachment.id),
			),
		),
		...sendObjects.map((key) => deleteBlobObject(env, key)),
	]);
	return { attachments: attachments.length, sends: sendObjects.length };
}
