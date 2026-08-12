import type { Kysely } from "kysely";
import { createDatabase } from "../middleware/db";
import type { DB } from "../types/db";
import { now } from "../utils/time";
import {
	deleteBlobObject,
	getAttachmentObjectKey,
	getSendFileObjectKey,
} from "./blob-store";
import * as attachmentsDb from "./db/attachments";
import { textColumnInJson } from "./db/json-array";

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
	if (!ciphers.length) return 0;
	const cipherIds = ciphers.map((cipher) => cipher.id);
	const attachments = await attachmentsDb.listByCipherIds(db, cipherIds);
	const deleted = await db
		.deleteFrom("ciphers")
		.where(textColumnInJson("id", cipherIds))
		.where("purge_after", "<=", timestamp)
		.returning("id")
		.execute();
	const deletedIds = new Set(deleted.map((cipher) => cipher.id));
	await Promise.allSettled(
		attachments
			.filter((attachment) => deletedIds.has(attachment.cipher_id))
			.map((attachment) =>
				deleteBlobObject(
					env,
					getAttachmentObjectKey(attachment.cipher_id, attachment.id),
				),
			),
	);
	return deleted.length;
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
	const deleted = await db
		.deleteFrom("sends")
		.where(
			textColumnInJson(
				"id",
				sends.map((send) => send.id),
			),
		)
		.where("deletion_date", "<=", timestamp)
		.returning("id")
		.execute();
	await Promise.allSettled(
		deleted.flatMap((send) => {
			const key = objectKeys.get(send.id);
			return key ? [deleteBlobObject(env, key)] : [];
		}),
	);
	return deleted.length;
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
