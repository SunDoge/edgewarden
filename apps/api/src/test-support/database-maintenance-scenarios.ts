import assert from "node:assert/strict";
import { test } from "vitest";
import { createDatabase } from "../middleware/db";
import { executeBatch } from "../services/db/batch";
import { runMaintenance } from "../services/maintenance";

export interface DatabaseMaintenanceScenarioContext {
	readonly database: D1Database;
	readonly bindings: CloudflareBindings;
	readonly r2Values: Map<string, Uint8Array>;
	email: string;
}

export function registerDatabaseMaintenanceScenarios(
	context: DatabaseMaintenanceScenarioContext,
): void {
	const EMAIL = context.email;
	test("database enforces cipher ownership and type invariants", async () => {
		const { db } = await createDatabase(context.database);
		try {
			const timestamp = Math.floor(Date.now() / 1000);
			const baseCipher = {
				id: crypto.randomUUID(),
				user_id: null,
				org_id: null,
				type: 1,
				folder_id: null,
				name: "invalid-owner",
				notes: null,
				fields: null,
				password_history: null,
				favorite: 0,
				data: "{}",
				reprompt: 0,
				key: null,
				created_at: timestamp,
				updated_at: timestamp,
				archived_at: null,
				deleted_at: null,
				purge_after: null,
			};

			await assert.rejects(() =>
				db.insertInto("ciphers").values(baseCipher).execute(),
			);

			const user = await db
				.selectFrom("users")
				.select("id")
				.where("email", "=", EMAIL)
				.executeTakeFirstOrThrow();
			await assert.rejects(() =>
				db
					.insertInto("ciphers")
					.values({
						...baseCipher,
						id: crypto.randomUUID(),
						user_id: user.id,
						type: 9,
					})
					.execute(),
			);
		} finally {
			await db.destroy();
		}
	});

	test("scheduled maintenance removes expired rows and blob objects", async () => {
		const { db } = await createDatabase(context.database);
		const timestamp = Math.floor(Date.now() / 1000);
		const user = await db
			.selectFrom("users")
			.select("id")
			.where("email", "=", EMAIL)
			.executeTakeFirstOrThrow();
		const cipherId = crypto.randomUUID();
		const attachmentId = crypto.randomUUID();
		const sendId = crypto.randomUUID();
		const fileId = crypto.randomUUID();
		const refreshToken = `expired-${crypto.randomUUID()}`;
		const expiredChallenge = `expired-${crypto.randomUUID()}`;
		const usedChallenge = `used-${crypto.randomUUID()}`;
		try {
			await db
				.insertInto("refresh_tokens")
				.values({
					token: refreshToken,
					user_id: user.id,
					expires_at: timestamp - 1,
					device_identifier: null,
					device_session_stamp: null,
				})
				.execute();
			await db
				.insertInto("webauthn_challenges")
				.values([
					{
						challenge_hash: expiredChallenge,
						scope: "login",
						user_id: user.id,
						expires_at: timestamp - 1,
						used_at: null,
						created_at: timestamp - 2,
					},
					{
						challenge_hash: usedChallenge,
						scope: "login",
						user_id: user.id,
						expires_at: timestamp + 3600,
						used_at: timestamp - 1,
						created_at: timestamp - 2,
					},
				])
				.execute();
			await db
				.insertInto("ciphers")
				.values({
					id: cipherId,
					user_id: user.id,
					org_id: null,
					type: 1,
					folder_id: null,
					name: "expired-cipher",
					notes: null,
					fields: null,
					password_history: null,
					favorite: 0,
					data: "{}",
					reprompt: 0,
					key: null,
					created_at: timestamp - 2,
					updated_at: timestamp - 2,
					archived_at: null,
					deleted_at: timestamp - 2,
					purge_after: timestamp - 1,
				})
				.execute();
			await db
				.insertInto("attachments")
				.values({
					id: attachmentId,
					cipher_id: cipherId,
					file_name: "encrypted-name",
					size: 3,
					size_name: "3 bytes",
					key: null,
					created_at: timestamp - 2,
				})
				.execute();
			await db
				.insertInto("sends")
				.values({
					id: sendId,
					user_id: user.id,
					org_id: null,
					type: 1,
					name: "expired-send",
					notes: null,
					data: JSON.stringify({ id: fileId }),
					key: "encrypted-key",
					password_hash: null,
					password_salt: null,
					password_iterations: null,
					password_algorithm: null,
					auth_type: 2,
					emails: null,
					max_access_count: null,
					access_count: 0,
					disabled: 0,
					hide_email: null,
					created_at: timestamp - 2,
					updated_at: timestamp - 2,
					expiration_date: null,
					deletion_date: timestamp - 1,
				})
				.execute();

			context.r2Values.set(
				`attachments/${cipherId}/${attachmentId}.bin`,
				new Uint8Array([1]),
			);
			context.r2Values.set(`sends/${sendId}/${fileId}`, new Uint8Array([2]));
			const result = await runMaintenance(db, context.bindings, timestamp);
			assert.ok(result.refreshTokens >= 1);
			assert.ok(result.webauthnChallenges >= 2);
			assert.ok(result.purgedCiphers >= 1);
			assert.ok(result.purgedSends >= 1);
			assert.equal(
				context.r2Values.has(`attachments/${cipherId}/${attachmentId}.bin`),
				false,
			);
			assert.equal(context.r2Values.has(`sends/${sendId}/${fileId}`), false);
			assert.deepEqual(
				await db
					.selectFrom("webauthn_challenges")
					.select("challenge_hash")
					.where("challenge_hash", "in", [expiredChallenge, usedChallenge])
					.execute(),
				[],
			);
			assert.equal(
				await db
					.selectFrom("refresh_tokens")
					.select("token")
					.where("token", "=", refreshToken)
					.executeTakeFirst(),
				undefined,
			);
			assert.equal(
				await db
					.selectFrom("ciphers")
					.select("id")
					.where("id", "=", cipherId)
					.executeTakeFirst(),
				undefined,
			);
			assert.equal(
				await db
					.selectFrom("sends")
					.select("id")
					.where("id", "=", sendId)
					.executeTakeFirst(),
				undefined,
			);
		} finally {
			await db.destroy();
		}
	});

	test("scheduled GC keeps tombstones when blob deletion fails and retries later", async () => {
		const { db } = await createDatabase(context.database);
		const timestamp = Math.floor(Date.now() / 1000);
		const user = await db
			.selectFrom("users")
			.select("id")
			.where("email", "=", EMAIL)
			.executeTakeFirstOrThrow();
		const cipherId = crypto.randomUUID();
		const attachmentId = crypto.randomUUID();
		const activeCipherId = crypto.randomUUID();
		const deletedAttachmentId = crypto.randomUUID();
		const sendId = crypto.randomUUID();
		const fileId = crypto.randomUUID();
		const attachmentKey = `attachments/${cipherId}/${attachmentId}.bin`;
		const deletedAttachmentKey = `attachments/${activeCipherId}/${deletedAttachmentId}.bin`;
		const sendKey = `sends/${sendId}/${fileId}`;
		const r2 = context.bindings.ATTACHMENTS_R2 as R2Bucket;
		const originalDelete = r2.delete.bind(r2);
		try {
			await db
				.insertInto("ciphers")
				.values([
					{
						id: cipherId,
						user_id: user.id,
						org_id: null,
						type: 1,
						folder_id: null,
						name: "deferred-purge-cipher",
						notes: null,
						fields: null,
						password_history: null,
						favorite: 0,
						data: "{}",
						reprompt: 0,
						key: null,
						created_at: timestamp - 2,
						updated_at: timestamp - 2,
						archived_at: null,
						deleted_at: timestamp - 2,
						purge_after: timestamp - 1,
					},
					{
						id: activeCipherId,
						user_id: user.id,
						org_id: null,
						type: 1,
						folder_id: null,
						name: "active-cipher-with-deleted-attachment",
						notes: null,
						fields: null,
						password_history: null,
						favorite: 0,
						data: "{}",
						reprompt: 0,
						key: null,
						created_at: timestamp - 2,
						updated_at: timestamp - 2,
						archived_at: null,
						deleted_at: null,
						purge_after: null,
					},
				])
				.execute();
			await db
				.insertInto("attachments")
				.values([
					{
						id: attachmentId,
						cipher_id: cipherId,
						file_name: "encrypted-name",
						size: 1,
						size_name: "1 Byte",
						key: null,
						storage_key: attachmentKey,
						created_at: timestamp - 2,
						deleted_at: null,
					},
					{
						id: deletedAttachmentId,
						cipher_id: activeCipherId,
						file_name: "deleted-encrypted-name",
						size: 1,
						size_name: "1 Byte",
						key: null,
						storage_key: deletedAttachmentKey,
						created_at: timestamp - 2,
						deleted_at: timestamp - 1,
					},
				])
				.execute();
			await db
				.insertInto("sends")
				.values({
					id: sendId,
					user_id: user.id,
					org_id: null,
					type: 1,
					name: "deferred-purge-send",
					notes: null,
					data: JSON.stringify({ id: fileId }),
					key: "encrypted-key",
					password_hash: null,
					password_salt: null,
					password_iterations: null,
					password_algorithm: null,
					auth_type: 2,
					emails: null,
					max_access_count: null,
					access_count: 0,
					disabled: 0,
					hide_email: null,
					created_at: timestamp - 2,
					updated_at: timestamp - 2,
					expiration_date: null,
					deletion_date: timestamp - 1,
				})
				.execute();
			context.r2Values.set(attachmentKey, new Uint8Array([1]));
			context.r2Values.set(deletedAttachmentKey, new Uint8Array([3]));
			context.r2Values.set(sendKey, new Uint8Array([2]));

			const failingKeys = new Set([
				attachmentKey,
				deletedAttachmentKey,
				sendKey,
			]);
			r2.delete = async (key: string | string[]) => {
				const keys = Array.isArray(key) ? key : [key];
				if (keys.some((candidate) => failingKeys.has(candidate))) {
					throw new Error("simulated R2 outage");
				}
				await originalDelete(key);
			};
			const deferred = await runMaintenance(db, context.bindings, timestamp);
			assert.equal(deferred.purgedCiphers, 0);
			assert.equal(deferred.purgedAttachments, 0);
			assert.equal(deferred.purgedSends, 0);
			assert.equal(context.r2Values.has(attachmentKey), true);
			assert.equal(context.r2Values.has(deletedAttachmentKey), true);
			assert.equal(context.r2Values.has(sendKey), true);
			assert.ok(
				await db
					.selectFrom("ciphers")
					.select("id")
					.where("id", "=", cipherId)
					.executeTakeFirst(),
			);
			assert.ok(
				await db
					.selectFrom("sends")
					.select("id")
					.where("id", "=", sendId)
					.executeTakeFirst(),
			);

			r2.delete = originalDelete;
			const recovered = await runMaintenance(
				db,
				context.bindings,
				timestamp + 1,
			);
			assert.ok(recovered.purgedCiphers >= 1);
			assert.ok(recovered.purgedAttachments >= 1);
			assert.ok(recovered.purgedSends >= 1);
			assert.equal(context.r2Values.has(attachmentKey), false);
			assert.equal(context.r2Values.has(deletedAttachmentKey), false);
			assert.equal(context.r2Values.has(sendKey), false);
			assert.equal(
				await db
					.selectFrom("attachments")
					.select("id")
					.where("id", "=", deletedAttachmentId)
					.executeTakeFirst(),
				undefined,
			);
			assert.ok(
				await db
					.selectFrom("ciphers")
					.select("id")
					.where("id", "=", activeCipherId)
					.executeTakeFirst(),
			);
			assert.equal(
				await db
					.selectFrom("ciphers")
					.select("id")
					.where("id", "=", cipherId)
					.executeTakeFirst(),
				undefined,
			);
			assert.equal(
				await db
					.selectFrom("sends")
					.select("id")
					.where("id", "=", sendId)
					.executeTakeFirst(),
				undefined,
			);
		} finally {
			r2.delete = originalDelete;
			await db.deleteFrom("ciphers").where("id", "=", cipherId).execute();
			await db.deleteFrom("ciphers").where("id", "=", activeCipherId).execute();
			await db.deleteFrom("sends").where("id", "=", sendId).execute();
			context.r2Values.delete(attachmentKey);
			context.r2Values.delete(deletedAttachmentKey);
			context.r2Values.delete(sendKey);
			await db.destroy();
		}
	});

	test("rolls back every statement when a Kysely-D1 batch fails", async () => {
		const { db, dialect } = await createDatabase(context.database);
		try {
			const user = await db
				.selectFrom("users")
				.select("id")
				.where("email", "=", EMAIL)
				.executeTakeFirstOrThrow();
			const folderId = crypto.randomUUID();
			const timestamp = Math.floor(Date.now() / 1000);
			const insert = db
				.insertInto("folders")
				.values({
					id: folderId,
					user_id: user.id,
					name: "atomic-folder",
					created_at: timestamp,
					updated_at: timestamp,
				})
				.compile();

			await assert.rejects(() => executeBatch(dialect, [insert, insert]));
			const rolledBack = await db
				.selectFrom("folders")
				.select("id")
				.where("id", "=", folderId)
				.executeTakeFirst();
			assert.equal(rolledBack, undefined);
		} finally {
			await db.destroy();
		}
	});
}
