import assert from "node:assert/strict";
import { test } from "vitest";
import { createDatabase } from "../middleware/db";
import { applyAuditLogRetention, safeWriteAuditEvent } from "../services/audit";
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
			await db
				.insertInto("ciphers")
				.values({
					id: cipherId,
					user_id: user.id,
					org_id: null,
					type: 1,
					folder_id: null,
					name: "gc-restore-race",
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
				.execute();
			context.r2Values.delete(storageKey);
			await db.destroy();
		}
	});

	test("retention never trims deletion tombstones", async () => {
		const { db } = await createDatabase(context.database);
		const ordinaryTarget = crypto.randomUUID();
		const deletedTarget = crypto.randomUUID();
		try {
			await safeWriteAuditEvent(db, {
				action: "vault.read",
				category: "vault",
				targetType: "cipher",
				targetId: ordinaryTarget,
			});
			await safeWriteAuditEvent(db, {
				action: "cipher.delete.permanent",
				category: "vault",
				targetType: "cipher",
				targetId: deletedTarget,
			});
			await db
				.updateTable("audit_logs")
				.set({ created_at: 1 })
				.where("target_id", "in", [ordinaryTarget, deletedTarget])
				.execute();

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
				.where("target_id", "in", [ordinaryTarget, deletedTarget])
				.execute();
			await db.destroy();
		}
	});
}
