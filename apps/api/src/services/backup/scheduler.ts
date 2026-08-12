import { D1Dialect } from "@sundoge/kysely-d1";
import { Kysely, sql } from "kysely";
import type { DB } from "../../types/db";
import { createBlobStore } from "../blob-store";
import {
	buildBackupArchive,
	verifyBackupArchiveFileNameChecksum,
} from "./archive";
import {
	getBackupLocalDateKey,
	isBackupDueNow,
	loadBackupSettings,
	saveBackupSettings,
} from "./config";
import {
	createRemoteBackupTransferSession,
	pruneRemoteBackupArchives,
} from "./uploader";

async function createBackupDatabase(d1: D1Database): Promise<Kysely<DB>> {
	const db = new Kysely<DB>({ dialect: new D1Dialect({ database: d1 }) });
	await sql`PRAGMA foreign_keys = ON`.execute(db);
	return db;
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export interface ScheduledBackupResult {
	due: number;
	succeeded: number;
	failed: number;
}

export async function runScheduledBackupIfDue(
	env: CloudflareBindings,
): Promise<ScheduledBackupResult> {
	const db = await createBackupDatabase(env.DB);
	const dataEncryptionSecret = env.DATA_ENCRYPTION_SECRET;
	const blobStore = createBlobStore(env);
	const result: ScheduledBackupResult = { due: 0, succeeded: 0, failed: 0 };
	try {
		const settings = await loadBackupSettings(db, dataEncryptionSecret, "UTC");

		const currentTime = new Date();
		for (const destination of settings.destinations) {
			if (
				!destination.schedule.enabled ||
				!isBackupDueNow(destination, currentTime)
			) {
				continue;
			}
			result.due += 1;
			try {
				destination.runtime.lastAttemptAt = currentTime.toISOString();
				destination.runtime.lastAttemptLocalDate = getBackupLocalDateKey(
					currentTime,
					destination.schedule.timezone,
				);
				destination.runtime.lastErrorAt = null;
				destination.runtime.lastErrorMessage = null;
				await saveBackupSettings(db, dataEncryptionSecret, settings);

				const archive = await buildBackupArchive(db, currentTime, {
					includeAttachments: destination.includeAttachments,
					blobStore,
					timeZone: destination.schedule.timezone,
				});
				const session = createRemoteBackupTransferSession(destination);
				const upload = await session.uploadArchive(
					archive.bytes,
					archive.fileName,
				);
				const remoteFile = await session.download(archive.fileName);
				const checksumValid = await verifyBackupArchiveFileNameChecksum(
					remoteFile.bytes,
					archive.fileName,
				);
				if (
					!checksumValid ||
					remoteFile.bytes.byteLength !== archive.bytes.byteLength
				) {
					throw new Error("Remote backup ZIP integrity verification failed");
				}

				if (destination.schedule.retentionCount !== null) {
					await pruneRemoteBackupArchives(
						destination,
						destination.schedule.retentionCount,
						archive.fileName,
					);
				}
				destination.runtime.lastSuccessAt = new Date().toISOString();
				destination.runtime.lastErrorAt = null;
				destination.runtime.lastErrorMessage = null;
				destination.runtime.lastUploadedFileName = archive.fileName;
				destination.runtime.lastUploadedSizeBytes = archive.bytes.byteLength;
				destination.runtime.lastUploadedDestination = upload.remotePath;
				await saveBackupSettings(db, dataEncryptionSecret, settings);
				result.succeeded += 1;
			} catch (error: unknown) {
				result.failed += 1;
				destination.runtime.lastErrorAt = new Date().toISOString();
				destination.runtime.lastErrorMessage = errorMessage(
					error,
					"Scheduled backup failed",
				);
				await saveBackupSettings(db, dataEncryptionSecret, settings).catch(
					() => null,
				);
				console.error(
					JSON.stringify({
						event: "backup.scheduled.failed",
						destinationId: destination.id,
						destinationType: destination.type,
						error: destination.runtime.lastErrorMessage,
					}),
				);
			}
		}
		return result;
	} finally {
		await db.destroy();
	}
}
