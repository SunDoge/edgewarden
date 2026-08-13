import assert from "node:assert/strict";
import { test } from "vitest";
import { createDatabase } from "../middleware/db";
import { applyAuditLogRetention, safeWriteAuditEvent } from "../services/audit";
import {
	acquireDataOperationLease,
	releaseDataOperationLease,
} from "../services/backup/operation-lease";
import { runMaintenance } from "../services/maintenance";

export interface MaintenanceReliabilityScenarioContext {
	readonly database: D1Database;
	readonly bindings: CloudflareBindings;
	readonly r2Values: Map<string, Uint8Array>;
	email: string;
}

export function registerMaintenanceReliabilityScenarios(
	context: MaintenanceReliabilityScenarioContext,
): void {
	async function insertExpiredCipher(
		db: Awaited<ReturnType<typeof createDatabase>>["db"],
		userId: string,
		cipherId: string,
		timestamp: number,
		purgeToken: string | null = null,
	): Promise<void> {
		await db
			.insertInto("ciphers")
			.values({
				id: cipherId,
				user_id: userId,
				org_id: null,
				type: 1,
				folder_id: null,
				name: "gc-reliability-cipher",
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
				purge_token: purgeToken,
			})
			.execute();
	}

	test("fences cipher restore before deleting attachment objects", async () => {
		const { db } = await createDatabase(context.database);
		const user = await db
			.selectFrom("users")
			.select("id")
			.where("email", "=", context.email)
			.executeTakeFirstOrThrow();
		const timestamp = Math.floor(Date.now() / 1000);
		const cipherId = crypto.randomUUID();
		const attachmentId = crypto.randomUUID();
		const storageKey = `attachments/${cipherId}/${attachmentId}.bin`;
		const r2 = context.bindings.ATTACHMENTS_R2 as R2Bucket;
		const originalDelete = r2.delete.bind(r2);
		let restoreChanges = -1;

		try {
			await insertExpiredCipher(db, user.id, cipherId, timestamp);
			await db
				.insertInto("attachments")
				.values({
					id: attachmentId,
					cipher_id: cipherId,
					file_name: "encrypted-name",
					size: 1,
					size_name: "1 Byte",
					key: null,
					storage_key: storageKey,
					created_at: timestamp - 2,
					deleted_at: null,
				})
				.execute();
			context.r2Values.set(storageKey, new Uint8Array([42]));

			r2.delete = async (key: string | string[]) => {
				const keys = Array.isArray(key) ? key : [key];
				if (keys.includes(storageKey)) {
					const restore = await db
						.updateTable("ciphers")
						.set({ deleted_at: null, purge_after: null })
						.where("id", "=", cipherId)
						.where("purge_token", "is", null)
						.executeTakeFirst();
					restoreChanges = Number(restore.numUpdatedRows);
				}
				await originalDelete(key);
			};

			await runMaintenance(db, context.bindings, timestamp);
			assert.equal(restoreChanges, 0);
			assert.equal(context.r2Values.has(storageKey), false);
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
					.selectFrom("audit_logs")
					.select("is_tombstone")
					.where("action", "=", "cipher.purged")
					.where("target_id", "=", cipherId)
					.executeTakeFirstOrThrow()
					.then((row) => row.is_tombstone),
				1,
			);
		} finally {
			r2.delete = originalDelete;
			await db.deleteFrom("ciphers").where("id", "=", cipherId).execute();
			await db
				.deleteFrom("audit_logs")
				.where("target_id", "in", [cipherId, attachmentId])
				.where("is_tombstone", "=", 0)
				.execute();
			context.r2Values.delete(storageKey);
			await db.destroy();
		}
	});

	test("emits one purge tombstone across overlapping maintenance runs", async () => {
		const first = await createDatabase(context.database);
		const second = await createDatabase(context.database);
		const user = await first.db
			.selectFrom("users")
			.select("id")
			.where("email", "=", context.email)
			.executeTakeFirstOrThrow();
		const timestamp = Math.floor(Date.now() / 1000);
		const cipherId = crypto.randomUUID();
		try {
			await insertExpiredCipher(first.db, user.id, cipherId, timestamp);
			await Promise.all([
				runMaintenance(first.db, context.bindings, timestamp),
				runMaintenance(second.db, context.bindings, timestamp),
			]);
			const audits = await first.db
				.selectFrom("audit_logs")
				.select(({ fn }) => fn.countAll<number>().as("count"))
				.where("action", "=", "cipher.purged")
				.where("target_id", "=", cipherId)
				.executeTakeFirstOrThrow();
			assert.equal(Number(audits.count), 1);
			assert.equal(
				await first.db
					.selectFrom("ciphers")
					.select("id")
					.where("id", "=", cipherId)
					.executeTakeFirst(),
				undefined,
			);
		} finally {
			await first.db.deleteFrom("ciphers").where("id", "=", cipherId).execute();
			await first.db
				.deleteFrom("audit_logs")
				.where("target_id", "=", cipherId)
				.where("is_tombstone", "=", 0)
				.execute();
			await first.db.destroy();
			await second.db.destroy();
		}
	});

	test("takes over a purge claim left by an interrupted worker", async () => {
		const { db } = await createDatabase(context.database);
		const user = await db
			.selectFrom("users")
			.select("id")
			.where("email", "=", context.email)
			.executeTakeFirstOrThrow();
		const timestamp = Math.floor(Date.now() / 1000);
		const cipherId = crypto.randomUUID();
		const abandonedClaim = crypto.randomUUID();
		try {
			await insertExpiredCipher(
				db,
				user.id,
				cipherId,
				timestamp,
				abandonedClaim,
			);
			const result = await runMaintenance(db, context.bindings, timestamp);
			assert.ok(result.purgedCiphers >= 1);
			assert.equal(
				await db
					.selectFrom("ciphers")
					.select("id")
					.where("id", "=", cipherId)
					.executeTakeFirst(),
				undefined,
			);
			assert.ok(
				await db
					.selectFrom("audit_logs")
					.select("id")
					.where("action", "=", "cipher.purged")
					.where("target_id", "=", cipherId)
					.executeTakeFirst(),
			);
		} finally {
			await db.deleteFrom("ciphers").where("id", "=", cipherId).execute();
			await db
				.deleteFrom("audit_logs")
				.where("target_id", "=", cipherId)
				.where("is_tombstone", "=", 0)
				.execute();
			await db.destroy();
		}
	});

	test("retention never trims deletion tombstones", async () => {
		const { db } = await createDatabase(context.database);
		const ordinaryTarget = crypto.randomUUID();
		const deletedTarget = crypto.randomUUID();
		const deletedAuditId = crypto.randomUUID();
		try {
			await safeWriteAuditEvent(db, {
				action: "vault.read",
				category: "vault",
				targetType: "cipher",
				targetId: ordinaryTarget,
			});
			await db
				.insertInto("audit_logs")
				.values({
					id: deletedAuditId,
					actor_user_id: null,
					action: "cipher.delete.permanent",
					category: "vault",
					level: "info",
					target_type: "cipher",
					target_id: deletedTarget,
					metadata: "{}",
					is_tombstone: 1,
					created_at: 1,
				})
				.execute();
			await db
				.updateTable("audit_logs")
				.set({ created_at: 1 })
				.where("target_id", "=", ordinaryTarget)
				.execute();

			await assert.rejects(
				db
					.updateTable("audit_logs")
					.set({ target_id: crypto.randomUUID() })
					.where("target_id", "=", deletedTarget)
					.execute(),
			);

			const restoreLease = await acquireDataOperationLease(
				context.database,
				"backup.restore_legacy_test",
			);
			assert.ok(restoreLease);
			try {
				await context.database.batch([
					context.database
						.prepare("DELETE FROM audit_logs WHERE id = ?")
						.bind(deletedAuditId),
					context.database
						.prepare(`
							INSERT INTO audit_logs (
								id, actor_user_id, action, category, level,
								target_type, target_id, metadata, is_tombstone, created_at
							) VALUES (?, NULL, 'cipher.delete.permanent', 'vault', 'info',
								'cipher', ?, '{}', 1, 1)
						`)
						.bind(deletedAuditId, deletedTarget),
				]);
			} finally {
				await releaseDataOperationLease(context.database, restoreLease);
			}
			await assert.rejects(
				db
					.deleteFrom("audit_logs")
					.where("target_id", "=", deletedTarget)
					.execute(),
			);
			await assert.rejects(
				db
					.insertInto("audit_logs")
					.values({
						id: crypto.randomUUID(),
						actor_user_id: null,
						action: "cipher.delete",
						category: "vault",
						level: "info",
						target_type: "cipher",
						target_id: crypto.randomUUID(),
						metadata: "{}",
						is_tombstone: 0,
						created_at: 1,
					})
					.execute(),
			);

			await applyAuditLogRetention(db, {
				retentionDays: 7,
				maxEntries: null,
			});
			assert.equal(
				await db
					.selectFrom("audit_logs")
					.select("id")
					.where("target_id", "=", ordinaryTarget)
					.executeTakeFirst(),
				undefined,
			);
			assert.equal(
				await db
					.selectFrom("audit_logs")
					.select("is_tombstone")
					.where("target_id", "=", deletedTarget)
					.executeTakeFirstOrThrow()
					.then((row) => row.is_tombstone),
				1,
			);
		} finally {
			await db
				.deleteFrom("audit_logs")
				.where("target_id", "=", ordinaryTarget)
				.execute();
			await db.destroy();
		}
	});
}
