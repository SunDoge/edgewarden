import { type Kysely, sql } from "kysely";
import { createDatabase } from "../middleware/db";
import type { DB } from "../types/db";
import { now } from "../utils/time";
import {
	deleteBlobObject,
	getStoredAttachmentObjectKey,
	getSendFileObjectKey,
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
}

function affectedRows(result: {
	numDeletedRows?: bigint;
	numUpdatedRows?: bigint;
}) {
	return Number(result.numDeletedRows ?? result.numUpdatedRows ?? 0n);
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
			const deleted = await db
				.deleteFrom("ciphers")
				.where("id", "=", cipher.id)
				.where("purge_after", "<=", timestamp)
				.executeTakeFirst();
			purged += Number(deleted.numDeletedRows ?? 0n);
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
			await deleteBlobObject(env, getStoredAttachmentObjectKey(attachment));
			const deleted = await db
				.deleteFrom("attachments")
				.where("id", "=", attachment.id)
				.where("deleted_at", "is not", null)
				.executeTakeFirst();
			purged += Number(deleted.numDeletedRows ?? 0n);
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
		.select(["id", "type", "data"])
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
					objectKeys.set(send.id, getSendFileObjectKey(send.id, fileId));
				}
			} catch {
				// The row still must expire even if legacy file metadata is malformed.
			}
		}
	}
	let purged = 0;
	for (const send of sends) {
		try {
			const key = objectKeys.get(send.id);
			if (key) await deleteBlobObject(env, key);
			const deleted = await db
				.deleteFrom("sends")
				.where("id", "=", send.id)
				.where("deletion_date", "<=", timestamp)
				.executeTakeFirst();
			purged += Number(deleted.numDeletedRows ?? 0n);
		} catch (error) {
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
	timestamp: number,
): Promise<number> {
	const result = await db
		.deleteFrom("organizations")
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
		.executeTakeFirst();
	return Number(result.numDeletedRows ?? 0n);
}

async function purgeUsers(db: Kysely<DB>, timestamp: number): Promise<number> {
	const result = await db
		.deleteFrom("users")
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
		.executeTakeFirst();
	return Number(result.numDeletedRows ?? 0n);
}

export async function runMaintenance(
	db: Kysely<DB>,
	env: CloudflareBindings,
	timestamp = now(),
): Promise<MaintenanceResult> {
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
	const purgedAttachments = await purgeAttachments(db, env, timestamp);
	const purgedCiphers = await purgeCiphers(db, env, timestamp);
	const purgedSends = await purgeSends(db, env, timestamp);
	const purgedOrganizations = await purgeOrganizations(db, timestamp);
	const purgedUsers = await purgeUsers(db, timestamp);
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
	};
}

export async function runScheduledMaintenance(
	env: CloudflareBindings,
): Promise<MaintenanceResult> {
	const { db } = await createDatabase(env.DB);
	try {
		return await runMaintenance(db, env);
	} finally {
		await db.destroy();
	}
}
