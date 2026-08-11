import type { Kysely } from "kysely";
import { createDatabase } from "../middleware/db";
import type { DB } from "../types/db";
import { now } from "../utils/time";
import {
	deleteBlobObject,
	getAttachmentObjectKey,
	getSendFileObjectKey,
} from "./blob-store";

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
	purgedCiphers: number;
	purgedSends: number;
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
	let purged = 0;
	for (const cipher of ciphers) {
		const attachments = await db
			.selectFrom("attachments")
			.select("id")
			.where("cipher_id", "=", cipher.id)
			.execute();
		await Promise.all(
			attachments.map((attachment) =>
				deleteBlobObject(env, getAttachmentObjectKey(cipher.id, attachment.id)),
			),
		);
		const result = await db
			.deleteFrom("ciphers")
			.where("id", "=", cipher.id)
			.where("purge_after", "<=", timestamp)
			.executeTakeFirst();
		purged += affectedRows(result);
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
	let purged = 0;
	for (const send of sends) {
		if (send.type === 1) {
			try {
				const data = JSON.parse(send.data) as { id?: string; Id?: string };
				const fileId = String(data.id ?? data.Id ?? "").trim();
				if (fileId) {
					await deleteBlobObject(env, getSendFileObjectKey(send.id, fileId));
				}
			} catch {
				// The row still must expire even if legacy file metadata is malformed.
			}
		}
		const result = await db
			.deleteFrom("sends")
			.where("id", "=", send.id)
			.where("deletion_date", "<=", timestamp)
			.executeTakeFirst();
		purged += affectedRows(result);
	}
	return purged;
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
	const webauthnChallenges = affectedRows(
		await db
			.deleteFrom("webauthn_challenges")
			.where((expression) =>
				expression.or([
					expression("expires_at", "<=", timestamp),
					expression("used_at", "is not", null),
				]),
			)
			.executeTakeFirst(),
	);
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
	return {
		refreshTokens,
		deviceTrustTokens,
		webauthnChallenges,
		attachmentDownloadTokens,
		authRequests,
		loginAttempts,
		expiredInvites,
		purgedCiphers: await purgeCiphers(db, env, timestamp),
		purgedSends: await purgeSends(db, env, timestamp),
	};
}

export async function runScheduledMaintenance(
	env: CloudflareBindings,
): Promise<void> {
	const { db } = await createDatabase(env.DB);
	try {
		await runMaintenance(db, env);
	} finally {
		await db.destroy();
	}
}
