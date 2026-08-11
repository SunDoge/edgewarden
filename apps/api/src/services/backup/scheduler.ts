import { D1Dialect } from "@sundoge/kysely-d1";
import { Kysely, sql } from "kysely";
import type { DB } from "../../types/db";
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

export async function runScheduledBackupIfDue(
	d1: D1Database,
	jwtSecret: string,
): Promise<void> {
	const db = await createBackupDatabase(d1);
	try {
		const settings = await loadBackupSettings(db, jwtSecret, "UTC").catch(
			() => null,
		);
		if (!settings) return;

		const currentTime = new Date();
		for (const destination of settings.destinations) {
			if (
				!destination.schedule.enabled ||
				!isBackupDueNow(destination, currentTime)
			) {
				continue;
			}
			try {
				destination.runtime.lastAttemptAt = currentTime.toISOString();
				destination.runtime.lastAttemptLocalDate = getBackupLocalDateKey(
					currentTime,
					destination.schedule.timezone,
				);
				destination.runtime.lastErrorAt = null;
				destination.runtime.lastErrorMessage = null;
				await saveBackupSettings(db, jwtSecret, settings);

				const archive = await buildBackupArchive(db, currentTime, {
					includeAttachments: destination.includeAttachments,
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
				await saveBackupSettings(db, jwtSecret, settings);
			} catch (error: unknown) {
				destination.runtime.lastErrorAt = new Date().toISOString();
				destination.runtime.lastErrorMessage = errorMessage(
					error,
					"Scheduled backup failed",
				);
				await saveBackupSettings(db, jwtSecret, settings).catch(() => null);
			}
		}
	} finally {
		await db.destroy();
	}
}
