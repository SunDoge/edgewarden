import { type Kysely, sql } from "kysely";
import { createDatabase } from "../middleware/db";
import type { DB } from "../types/db";
import { now } from "../utils/time";
import {
	requireFreshDataOperationLease,
	withDataOperationLease,
} from "./backup/operation-lease";
import { type BlobGcResult, drainBlobGcQueue } from "./blob-gc";
import {
	createBlobStore,
	deleteBlobObject,
	getStoredAttachmentObjectKey,
	getStoredSendFileObjectKey,
} from "./blob-store";
import * as attachmentsDb from "./db/attachments";

const BATCH_LIMIT = 100;
const AUTH_REQUEST_RETENTION_SECONDS = 24 * 60 * 60;
const LOGIN_ATTEMPT_RETENTION_SECONDS = 24 * 60 * 60;

export interface MaintenanceResult {
	refreshTokens: number;
	deviceTrustTokens: number;
	webauthnChallenges: number;
	attachmentDownloadTokens: number;
	authRequests: number;
	loginAttempts: number;
	expiredInvites: number;
	purgedAttachments: number;
	purgedCiphers: number;
	purgedSends: number;
	purgedOrganizations: number;
	purgedUsers: number;
	blobGc: BlobGcResult;
}

function affectedRows(result: {
	numDeletedRows?: bigint;
	numUpdatedRows?: bigint;
}) {
	return Number(result.numDeletedRows ?? result.numUpdatedRows ?? 0n);
}

interface PurgeAuditEvent {
	action: string;
	category: "vault" | "org" | "admin";
	targetType: string;
	targetId: string;
}

function purgeAuditStatement(
	db: D1Database,
	event: PurgeAuditEvent,
	timestamp: number,
	eligibilitySql: string,
	eligibilityValues: unknown[],
): D1PreparedStatement {
	return db
		.prepare(`
			INSERT INTO audit_logs (
				id, actor_user_id, action, category, level,
				target_type, target_id, metadata, created_at
			)
			SELECT ?, NULL, ?, ?, 'info', ?, ?, '{"status":"purged"}', ?
			WHERE EXISTS (${eligibilitySql})
		`)
		.bind(
			crypto.randomUUID(),
			event.action,
			event.category,
			event.targetType,
			event.targetId,
			timestamp,
			...eligibilityValues,
		);
}

async function deleteWithPurgeAudit(
	db: D1Database,
	events: PurgeAuditEvent[],
	timestamp: number,
	eligibilitySql: string,
	eligibilityValues: unknown[],
	deleteSql: string,
	deleteValues: unknown[],
): Promise<number> {
	const statements = events.map((event) =>
		purgeAuditStatement(
			db,
			event,
			timestamp,
			eligibilitySql,
			eligibilityValues,
		),
	);
	statements.push(db.prepare(deleteSql).bind(...deleteValues));
	const results = await db.batch(statements);
	return Number(results.at(-1)?.meta?.changes ?? 0);
}

async function purgeCiphers(
	db: Kysely<DB>,
	env: CloudflareBindings,
	timestamp: number,
): Promise<number> {
	const ciphers = await db
		.selectFrom("ciphers")
		.select("id")
		.where("purge_after", "is not", null)
		.where("purge_after", "<=", timestamp)
		.orderBy("purge_after", "asc")
		.limit(BATCH_LIMIT)
		.execute();
	if (!ciphers.length) return 0;
	const attachments = Map.groupBy(
		await attachmentsDb.listByCipherIdsIncludingDeleted(
			db,
			ciphers.map((cipher) => cipher.id),
		),
		(attachment) => attachment.cipher_id,
	);
	let purged = 0;
	for (const cipher of ciphers) {
		try {
			// Keep the D1 tombstone until every external object is gone. Object
			// deletion is idempotent, so a later D1 failure is safe to retry.
			await Promise.all(
				(attachments.get(cipher.id) ?? []).map((attachment) =>
					deleteBlobObject(env, getStoredAttachmentObjectKey(attachment)),
				),
			);
			const cipherAttachments = attachments.get(cipher.id) ?? [];
			purged += await deleteWithPurgeAudit(
				env.DB,
				[
					...cipherAttachments.map((attachment) => ({
						action: "attachment.purged",
						category: "vault" as const,
						targetType: "attachment",
						targetId: attachment.id,
					})),
					{
						action: "cipher.purged",
						category: "vault",
						targetType: "cipher",
						targetId: cipher.id,
					},
				],
				timestamp,
				"SELECT 1 FROM ciphers WHERE id = ? AND purge_after <= ?",
				[cipher.id, timestamp],
				"DELETE FROM ciphers WHERE id = ? AND purge_after <= ?",
				[cipher.id, timestamp],
			);
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "maintenance.cipher_purge_deferred",
					cipherId: cipher.id,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}
	return purged;
}

async function purgeAttachments(
	db: Kysely<DB>,
	env: CloudflareBindings,
	timestamp: number,
): Promise<number> {
	const attachments = await db
		.selectFrom("attachments")
		.selectAll()
		.where("deleted_at", "is not", null)
		.where("deleted_at", "<=", timestamp)
		.orderBy("deleted_at", "asc")
		.limit(BATCH_LIMIT)
		.execute();
	let purged = 0;
	for (const attachment of attachments) {
		try {
			const objectKey = getStoredAttachmentObjectKey(attachment);
			await deleteBlobObject(env, objectKey);
			purged += await deleteWithPurgeAudit(
				env.DB,
				[
					{
						action: "attachment.purged",
						category: "vault",
						targetType: "attachment",
						targetId: attachment.id,
					},
				],
				timestamp,
				`SELECT 1 FROM attachments
				 WHERE id = ?
				   AND deleted_at IS NOT NULL
				   AND deletion_token IS ?
				   AND coalesce(storage_key, 'attachments/' || cipher_id || '/' || id || '.bin') = ?`,
				[attachment.id, attachment.deletion_token, objectKey],
				`DELETE FROM attachments
				 WHERE id = ?
				   AND deleted_at IS NOT NULL
				   AND deletion_token IS ?
				   AND coalesce(storage_key, 'attachments/' || cipher_id || '/' || id || '.bin') = ?`,
				[attachment.id, attachment.deletion_token, objectKey],
			);
		} catch (error) {
			console.error(
				JSON.stringify({
					event: "maintenance.attachment_purge_deferred",
					attachmentId: attachment.id,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}
	return purged;
}

async function purgeSends(
	db: Kysely<DB>,
	env: CloudflareBindings,
	timestamp: number,
): Promise<number> {
	const sends = await db
		.selectFrom("sends")
		.select([
			"id",
			"type",
			"data",
			"storage_key",
			"deletion_date",
			"purge_token",
		])
		.where("deletion_date", "<=", timestamp)
		.orderBy("deletion_date", "asc")
		.limit(BATCH_LIMIT)
		.execute();
	if (!sends.length) return 0;
	const objectKeys = new Map<string, string>();
	for (const send of sends) {
		if (send.type === 1) {
			try {
				const data = JSON.parse(send.data) as { id?: string; Id?: string };
				const fileId = String(data.id ?? data.Id ?? "").trim();
				if (fileId) {
					objectKeys.set(send.id, getStoredSendFileObjectKey(send, fileId));
				}
			} catch {
				// The row still must expire even if legacy file metadata is malformed.
			}
		}
	}
	let purged = 0;
	for (const send of sends) {
		const purgeToken = crypto.randomUUID();
		const claimed = await db
			.updateTable("sends")
			.set({ purge_token: purgeToken })
			.where("id", "=", send.id)
			.where("deletion_date", "=", send.deletion_date)
			.where("deletion_date", "<=", timestamp)
			.where("purge_token", "is", send.purge_token)
			.executeTakeFirst();
		if (Number(claimed.numUpdatedRows) !== 1) continue;
		try {
			const key = objectKeys.get(send.id);
			if (key) await deleteBlobObject(env, key);
			purged += await deleteWithPurgeAudit(
				env.DB,
				[
					{
						action: "send.purged",
						category: "vault",
						targetType: "send",
						targetId: send.id,
					},
				],
				timestamp,
				"SELECT 1 FROM sends WHERE id = ? AND deletion_date = ? AND purge_token = ?",
				[send.id, send.deletion_date, purgeToken],
				"DELETE FROM sends WHERE id = ? AND deletion_date = ? AND purge_token = ?",
				[send.id, send.deletion_date, purgeToken],
			);
		} catch (error) {
			await db
				.updateTable("sends")
				.set({ purge_token: send.purge_token })
				.where("id", "=", send.id)
				.where("purge_token", "=", purgeToken)
				.execute();
			console.error(
				JSON.stringify({
					event: "maintenance.send_purge_deferred",
					sendId: send.id,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}
	return purged;
}

async function purgeOrganizations(
	db: Kysely<DB>,
	env: CloudflareBindings,
	timestamp: number,
): Promise<number> {
	const organizations = await db
		.selectFrom("organizations")
		.select("id")
		.where("deletion_requested_at", "is not", null)
		.where("deletion_requested_at", "<=", timestamp)
		.where(
			sql<boolean>`not exists (
				select 1 from ciphers where ciphers.org_id = organizations.id
			)`,
		)
		.where(
			sql<boolean>`not exists (
				select 1 from sends where sends.org_id = organizations.id
			)`,
		)
		.orderBy("deletion_requested_at", "asc")
		.limit(BATCH_LIMIT)
		.execute();
	let purged = 0;
	const eligibilitySql = `
		SELECT 1 FROM organizations
		WHERE id = ? AND deletion_requested_at IS NOT NULL
			AND deletion_requested_at <= ?
			AND NOT EXISTS (SELECT 1 FROM ciphers WHERE ciphers.org_id = organizations.id)
			AND NOT EXISTS (SELECT 1 FROM sends WHERE sends.org_id = organizations.id)
	`;
	for (const organization of organizations) {
		purged += await deleteWithPurgeAudit(
			env.DB,
			[
				{
					action: "organization.purged",
					category: "org",
					targetType: "organization",
					targetId: organization.id,
				},
			],
			timestamp,
			eligibilitySql,
			[organization.id, timestamp],
			`DELETE FROM organizations
			 WHERE id = ? AND deletion_requested_at IS NOT NULL
			   AND deletion_requested_at <= ?
			   AND NOT EXISTS (SELECT 1 FROM ciphers WHERE ciphers.org_id = organizations.id)
			   AND NOT EXISTS (SELECT 1 FROM sends WHERE sends.org_id = organizations.id)`,
			[organization.id, timestamp],
		);
	}
	return purged;
}

async function purgeUsers(
	db: Kysely<DB>,
	env: CloudflareBindings,
	timestamp: number,
): Promise<number> {
	const users = await db
		.selectFrom("users")
		.select("id")
		.where("deletion_requested_at", "is not", null)
		.where("deletion_requested_at", "<=", timestamp)
		.where(
			sql<boolean>`not exists (
				select 1 from ciphers where ciphers.user_id = users.id
			)`,
		)
		.where(
			sql<boolean>`not exists (
				select 1 from sends where sends.user_id = users.id
			)`,
		)
		.where(
			sql<boolean>`not exists (
				select 1 from organizations where organizations.owner_id = users.id
			)`,
		)
		.orderBy("deletion_requested_at", "asc")
		.limit(BATCH_LIMIT)
		.execute();
	let purged = 0;
	const eligibilitySql = `
		SELECT 1 FROM users
		WHERE id = ? AND deletion_requested_at IS NOT NULL
			AND deletion_requested_at <= ?
			AND NOT EXISTS (SELECT 1 FROM ciphers WHERE ciphers.user_id = users.id)
			AND NOT EXISTS (SELECT 1 FROM sends WHERE sends.user_id = users.id)
			AND NOT EXISTS (SELECT 1 FROM organizations WHERE organizations.owner_id = users.id)
	`;
	for (const user of users) {
		purged += await deleteWithPurgeAudit(
			env.DB,
			[
				{
					action: "account.purged",
					category: "admin",
					targetType: "user",
					targetId: user.id,
				},
			],
			timestamp,
			eligibilitySql,
			[user.id, timestamp],
			`DELETE FROM users
			 WHERE id = ? AND deletion_requested_at IS NOT NULL
			   AND deletion_requested_at <= ?
			   AND NOT EXISTS (SELECT 1 FROM ciphers WHERE ciphers.user_id = users.id)
			   AND NOT EXISTS (SELECT 1 FROM sends WHERE sends.user_id = users.id)
			   AND NOT EXISTS (SELECT 1 FROM organizations WHERE organizations.owner_id = users.id)`,
			[user.id, timestamp],
		);
	}
	return purged;
}

export async function runMaintenance(
	db: Kysely<DB>,
	env: CloudflareBindings,
	timestamp = now(),
	checkpoint?: () => Promise<void>,
): Promise<MaintenanceResult> {
	const blobStore = createBlobStore(env);
	if (!blobStore) throw new Error("Attachment storage is not configured");
	const refreshTokens = affectedRows(
		await db
			.deleteFrom("refresh_tokens")
			.where("expires_at", "<=", timestamp)
			.executeTakeFirst(),
	);
	const deviceTrustTokens = affectedRows(
		await db
			.deleteFrom("device_trust_tokens")
			.where("expires_at", "<=", timestamp)
			.executeTakeFirst(),
	);
	const expiredWebauthnChallenges = affectedRows(
		await db
			.deleteFrom("webauthn_challenges")
			.where("expires_at", "<=", timestamp)
			.executeTakeFirst(),
	);
	const usedWebauthnChallenges = affectedRows(
		await db
			.deleteFrom("webauthn_challenges")
			.where("used_at", "is not", null)
			.executeTakeFirst(),
	);
	const webauthnChallenges = expiredWebauthnChallenges + usedWebauthnChallenges;
	const attachmentDownloadTokens = affectedRows(
		await db
			.deleteFrom("attachment_download_tokens")
			.where("expires_at", "<=", timestamp)
			.executeTakeFirst(),
	);
	const authRequests = affectedRows(
		await db
			.deleteFrom("auth_requests")
			.where("creation_date", "<=", timestamp - AUTH_REQUEST_RETENTION_SECONDS)
			.executeTakeFirst(),
	);
	const loginAttempts = affectedRows(
		await db
			.deleteFrom("login_attempts")
			.where("updated_at", "<=", timestamp - LOGIN_ATTEMPT_RETENTION_SECONDS)
			.executeTakeFirst(),
	);
	const expiredInvites = affectedRows(
		await db
			.updateTable("invites")
			.set({ status: "expired", updated_at: timestamp })
			.where("status", "=", "active")
			.where("expires_at", "<=", timestamp)
			.executeTakeFirst(),
	);
	await checkpoint?.();
	const purgedAttachments = await purgeAttachments(db, env, timestamp);
	await checkpoint?.();
	const purgedCiphers = await purgeCiphers(db, env, timestamp);
	await checkpoint?.();
	const purgedSends = await purgeSends(db, env, timestamp);
	await checkpoint?.();
	const purgedOrganizations = await purgeOrganizations(db, env, timestamp);
	await checkpoint?.();
	const purgedUsers = await purgeUsers(db, env, timestamp);
	await checkpoint?.();
	const blobGc = await drainBlobGcQueue(db, blobStore, timestamp);
	return {
		refreshTokens,
		deviceTrustTokens,
		webauthnChallenges,
		attachmentDownloadTokens,
		authRequests,
		loginAttempts,
		expiredInvites,
		purgedAttachments,
		purgedCiphers,
		purgedSends,
		purgedOrganizations,
		purgedUsers,
		blobGc,
	};
}

export async function runScheduledMaintenance(
	env: CloudflareBindings,
): Promise<MaintenanceResult> {
	return withDataOperationLease(
		env.DB,
		"maintenance.scheduled",
		async (lease) => {
			const { db } = await createDatabase(env.DB);
			try {
				return await runMaintenance(db, env, now(), () =>
					requireFreshDataOperationLease(env.DB, lease),
				);
			} finally {
				await db.destroy();
			}
		},
	);
}
