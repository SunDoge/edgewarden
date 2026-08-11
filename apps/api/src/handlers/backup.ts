import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import {
	BackupBlobQuerySchema,
	BackupExportSchema,
	BackupImportSchema,
	BackupRemoteFileQuerySchema,
	BackupRemoteQuerySchema,
	BackupRemoteRestoreSchema,
	BackupRunSchema,
	BackupSettingsSchema,
} from "../schemas/backup";
import {
	buildBackupArchive,
	inspectBackupArchiveFileNameChecksum,
	verifyBackupArchiveFileNameChecksum,
} from "../services/backup/archive";
import {
	getBackupLocalDateKey,
	loadBackupSettings,
	normalizeBackupSettingsInput,
	requireBackupDestination,
	saveBackupSettings,
} from "../services/backup/config";
import {
	importBackupArchiveBytes,
	importRemoteBackupArchiveBytes,
} from "../services/backup/import";
import {
	createRemoteBackupTransferSession,
	pruneRemoteBackupArchives,
} from "../services/backup/uploader";
import { createBlobStore } from "../services/blob-store";
import { errorResponse } from "../utils/response";

// Helper: Ensure backup attachment blob name is valid
function ensureBackupBlobName(value: string): string {
	const normalized = String(value || "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (!normalized) {
		throw new Error("Backup attachment blob is required");
	}
	const parts = normalized.split("/").filter(Boolean);
	if (
		parts.length === 0 ||
		parts.some((part) => part === "." || part === "..")
	) {
		throw new Error("Backup attachment blob is invalid");
	}
	return parts.join("/");
}

// 1. POST /api/admin/backup/export
export const exportBackup = factory.createHandlers(
	vValidator("json", BackupExportSchema),
	async (c) => {
		const db = c.get("db");
		const body = c.req.valid("json");

		try {
			const blobStore = createBlobStore(c.env);
			const archive = await buildBackupArchive(db, new Date(), {
				includeAttachments: !!body?.includeAttachments,
				blobStore,
			});

			return new Response(archive.bytes, {
				status: 200,
				headers: {
					"Content-Type": "application/zip",
					"Content-Disposition": `attachment; filename="${archive.fileName}"`,
					"Cache-Control": "no-store",
				},
			});
		} catch (error: any) {
			return errorResponse(error.message || "Backup export failed", 500);
		}
	},
);

// 2. GET /api/admin/backup/blob
export const getBackupBlob = factory.createHandlers(
	vValidator("query", BackupBlobQuerySchema),
	async (c) => {
		const blobNameRaw = c.req.valid("query").blobName;
		const blobStore = createBlobStore(c.env);
		if (!blobStore) {
			return errorResponse("Attachment storage is not configured", 409);
		}

		try {
			const blobName = ensureBackupBlobName(blobNameRaw);
			const object = await blobStore.get(blobName);
			if (!object?.body) {
				return errorResponse("Backup attachment blob not found", 404);
			}
			return new Response(object.body, {
				status: 200,
				headers: {
					"Content-Type": "application/octet-stream",
					"Cache-Control": "no-store",
				},
			});
		} catch (error: any) {
			return errorResponse(
				error.message || "Backup attachment download failed",
				400,
			);
		}
	},
);

// 3. GET /api/admin/backup/settings
export const getBackupSettings = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const secret = c.env.DATA_ENCRYPTION_SECRET;
	try {
		const settings = await loadBackupSettings(db, secret, "UTC");
		return c.json(settings);
	} catch (error: any) {
		return errorResponse(
			error.message || "Backup settings could not be loaded",
			409,
		);
	}
});

// 4. PUT /api/admin/backup/settings
export const updateBackupSettings = factory.createHandlers(
	vValidator("json", BackupSettingsSchema),
	async (c) => {
		const db = c.get("db");
		const secret = c.env.DATA_ENCRYPTION_SECRET;
		const body = c.req.valid("json");

		try {
			const previous = await loadBackupSettings(db, secret, "UTC");
			const normalized = normalizeBackupSettingsInput(body, previous);
			await saveBackupSettings(db, secret, normalized);
			return c.json(normalized);
		} catch (error: any) {
			return errorResponse(error.message || "Backup settings save failed", 400);
		}
	},
);

// 5. POST /api/admin/backup/run (Manual configured backup trigger)
export const runBackup = factory.createHandlers(
	vValidator("json", BackupRunSchema),
	async (c) => {
		const db = c.get("db");
		const secret = c.env.DATA_ENCRYPTION_SECRET;
		const body = c.req.valid("json");
		const destinationId = body.destinationId;

		try {
			const blobStore = createBlobStore(c.env);
			const currentSettings = await loadBackupSettings(db, secret, "UTC");
			const destination = requireBackupDestination(
				currentSettings,
				destinationId,
			);

			const now = new Date();
			destination.runtime.lastAttemptAt = now.toISOString();
			destination.runtime.lastAttemptLocalDate = getBackupLocalDateKey(
				now,
				destination.schedule.timezone,
			);
			destination.runtime.lastErrorAt = null;
			destination.runtime.lastErrorMessage = null;
			await saveBackupSettings(db, secret, currentSettings);

			// Build backup zip
			const archive = await buildBackupArchive(db, now, {
				includeAttachments: destination.includeAttachments,
				blobStore,
				timeZone: destination.schedule.timezone,
			});

			// Upload backup archive
			const remoteSession = createRemoteBackupTransferSession(destination);
			const upload = await remoteSession.uploadArchive(
				archive.bytes,
				archive.fileName,
			);

			// Verify remote archive checksum and size
			const remoteFile = await remoteSession.download(archive.fileName);
			const checksumOk = await verifyBackupArchiveFileNameChecksum(
				remoteFile.bytes,
				archive.fileName,
			);
			if (
				!checksumOk ||
				remoteFile.bytes.byteLength !== archive.bytes.byteLength
			) {
				throw new Error("Remote backup ZIP integrity verification failed");
			}

			// Prune old backups
			let prunedCount = 0;
			if (destination.schedule.retentionCount !== null) {
				prunedCount = await pruneRemoteBackupArchives(
					destination,
					destination.schedule.retentionCount,
					archive.fileName,
				);
			}

			// Save success state
			destination.runtime.lastSuccessAt = new Date().toISOString();
			destination.runtime.lastErrorAt = null;
			destination.runtime.lastErrorMessage = null;
			destination.runtime.lastUploadedFileName = archive.fileName;
			destination.runtime.lastUploadedSizeBytes = archive.bytes.byteLength;
			destination.runtime.lastUploadedDestination = upload.remotePath;
			await saveBackupSettings(db, secret, currentSettings);

			return c.json({
				result: {
					fileName: archive.fileName,
					fileSize: archive.bytes.byteLength,
					remotePath: upload.remotePath,
					provider: upload.provider,
					prunedCount,
				},
				settings: currentSettings,
			});
		} catch (error: any) {
			const currentSettings = await loadBackupSettings(db, secret, "UTC").catch(
				() => null,
			);
			if (currentSettings) {
				const dest = requireBackupDestination(currentSettings, destinationId);
				dest.runtime.lastErrorAt = new Date().toISOString();
				dest.runtime.lastErrorMessage = error.message || "Backup upload failed";
				await saveBackupSettings(db, secret, currentSettings).catch(() => null);
			}
			return errorResponse(error.message || "Backup run failed", 500);
		}
	},
);

// 6. GET /api/admin/backup/remote
export const listRemoteBackups = factory.createHandlers(
	vValidator("query", BackupRemoteQuerySchema),
	async (c) => {
		const db = c.get("db");
		const secret = c.env.DATA_ENCRYPTION_SECRET;
		const { destinationId, path } = c.req.valid("query");

		try {
			const settings = await loadBackupSettings(db, secret, "UTC");
			const destination = requireBackupDestination(settings, destinationId);
			const session = createRemoteBackupTransferSession(destination);
			const list = await session.list(path);
			return c.json(list);
		} catch (error: any) {
			return errorResponse(
				error.message || "Failed to list remote backups",
				500,
			);
		}
	},
);

// 7. GET /api/admin/backup/remote/download
export const downloadRemoteBackup = factory.createHandlers(
	vValidator("query", BackupRemoteFileQuerySchema),
	async (c) => {
		const db = c.get("db");
		const secret = c.env.DATA_ENCRYPTION_SECRET;
		const { destinationId, path } = c.req.valid("query");

		try {
			const settings = await loadBackupSettings(db, secret, "UTC");
			const destination = requireBackupDestination(settings, destinationId);
			const session = createRemoteBackupTransferSession(destination);
			const file = await session.download(path);

			return new Response(file.bytes, {
				status: 200,
				headers: {
					"Content-Type": file.contentType || "application/zip",
					"Content-Disposition": `attachment; filename="${file.fileName}"`,
					"Cache-Control": "no-store",
				},
			});
		} catch (error: any) {
			return errorResponse(
				error.message || "Failed to download remote backup",
				500,
			);
		}
	},
);

// 8. GET /api/admin/backup/remote/integrity
export const inspectRemoteBackup = factory.createHandlers(
	vValidator("query", BackupRemoteFileQuerySchema),
	async (c) => {
		const db = c.get("db");
		const secret = c.env.DATA_ENCRYPTION_SECRET;
		const { destinationId, path } = c.req.valid("query");

		try {
			const settings = await loadBackupSettings(db, secret, "UTC");
			const destination = requireBackupDestination(settings, destinationId);
			const session = createRemoteBackupTransferSession(destination);
			const file = await session.download(path);
			const integrity = await inspectBackupArchiveFileNameChecksum(
				file.bytes,
				file.fileName,
			);

			return c.json({
				object: "backup-remote-integrity",
				destinationId,
				path,
				fileName: file.fileName,
				integrity,
			});
		} catch (error: any) {
			return errorResponse(
				error.message || "Failed to inspect remote backup",
				500,
			);
		}
	},
);

// 9. DELETE /api/admin/backup/remote/file
export const deleteRemoteBackup = factory.createHandlers(
	vValidator("query", BackupRemoteFileQuerySchema),
	async (c) => {
		const db = c.get("db");
		const secret = c.env.DATA_ENCRYPTION_SECRET;
		const { destinationId, path } = c.req.valid("query");

		try {
			const settings = await loadBackupSettings(db, secret, "UTC");
			const destination = requireBackupDestination(settings, destinationId);
			const session = createRemoteBackupTransferSession(destination);
			await session.deleteFile(path);
			return new Response(null, { status: 204 });
		} catch (error: any) {
			return errorResponse(
				error.message || "Failed to delete remote backup file",
				500,
			);
		}
	},
);

// 10. POST /api/admin/backup/remote/restore
export const restoreRemoteBackup = factory.createHandlers(
	vValidator("json", BackupRemoteRestoreSchema),
	async (c) => {
		const db = c.get("db");
		const secret = c.env.DATA_ENCRYPTION_SECRET;
		const user = c.get("user");
		const body = c.req.valid("json");
		const { destinationId, path, replaceExisting, allowChecksumMismatch } =
			body;

		try {
			const settings = await loadBackupSettings(db, secret, "UTC");
			const destination = requireBackupDestination(settings, destinationId);
			const session = createRemoteBackupTransferSession(destination);

			// Download file from remote destination
			const file = await session.download(path);

			// Verify checksum
			const checksumOk = await verifyBackupArchiveFileNameChecksum(
				file.bytes,
				file.fileName,
			);
			if (!checksumOk && !allowChecksumMismatch) {
				throw new Error("Backup file checksum does not match its filename");
			}

			const result = await importRemoteBackupArchiveBytes(
				file.bytes,
				c.env.DB,
				createBlobStore(c.env),
				secret,
				user.id,
				!!replaceExisting,
				{
					loadAttachment: async (blobName: string) => {
						const attachmentFile = await session.download(blobName);
						return attachmentFile.bytes;
					},
				},
				undefined,
				file.fileName,
			);

			return c.json(result.result);
		} catch (error: any) {
			return errorResponse(
				error.message || "Failed to restore remote backup",
				500,
			);
		}
	},
);

// 11. POST /api/admin/backup/import
export const importBackup = factory.createHandlers(
	vValidator("form", BackupImportSchema),
	async (c) => {
		const secret = c.env.DATA_ENCRYPTION_SECRET;
		const user = c.get("user");
		const body = c.req.valid("form");
		const file = body.file;
		const replaceExisting = body.replaceExisting === "1";
		const allowChecksumMismatch = body.allowChecksumMismatch === "1";

		let archiveBytes: Uint8Array;
		try {
			archiveBytes = new Uint8Array(await (file as File).arrayBuffer());
		} catch {
			return errorResponse("Unable to read backup file", 400);
		}

		try {
			const fileName = String((file as File).name || "");
			const checksumOk = await verifyBackupArchiveFileNameChecksum(
				archiveBytes,
				fileName,
			);
			if (!checksumOk && !allowChecksumMismatch) {
				return errorResponse(
					"Backup file checksum does not match its filename",
					400,
				);
			}

			const imported = await importBackupArchiveBytes(
				archiveBytes,
				c.env.DB,
				createBlobStore(c.env),
				secret,
				user.id,
				replaceExisting,
				undefined,
				fileName || "edgewarden_backup.zip",
			);

			return c.json(imported.result);
		} catch (error: any) {
			const msg = error.message || "Backup import failed";
			return errorResponse(
				msg,
				msg.includes("requires a fresh instance") ? 409 : 500,
			);
		}
	},
);
