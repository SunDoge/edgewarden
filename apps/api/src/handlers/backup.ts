import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import {
	BackupBlobQuerySchema,
	BackupExportSchema,
	BackupImportSchema,
	BackupRunSchema,
	BackupSettingsSchema,
} from "../schemas/backup";
import { safeWriteAuditEvent } from "../services/audit";
import {
	assertBackupArchiveIntegrity,
	buildBackupArchive,
	verifyBackupArchiveFileNameChecksum,
} from "../services/backup/archive";
import {
	getBackupLocalDateKey,
	loadBackupSettings,
	normalizeBackupSettingsInput,
	requireBackupDestination,
	saveBackupSettings,
} from "../services/backup/config";
import { importBackupArchiveBytes } from "../services/backup/import";
import {
	acquireDataOperationLease,
	releaseDataOperationLease,
	requireDataOperationLeaseRenewal,
	requireFreshDataOperationLease,
	withDataOperationLease,
} from "../services/backup/operation-lease";
import {
	createRemoteBackupTransferSession,
	pruneRemoteBackupArchives,
} from "../services/backup/uploader";
import { createBlobStore } from "../services/blob-store";
import { errorResponse } from "../utils/response";

function ensureBackupBlobName(value: string): string {
	const normalized = String(value || "")
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (!normalized) throw new Error("Backup attachment blob is required");
	const parts = normalized.split("/").filter(Boolean);
	if (
		parts.length === 0 ||
		parts.some((part) => part === "." || part === "..")
	) {
		throw new Error("Backup attachment blob is invalid");
	}
	return parts.join("/");
}

function backupErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export const exportBackup = factory.createHandlers(
	vValidator("json", BackupExportSchema),
	async (c) => {
		try {
			return await withDataOperationLease(
				c.env.DB,
				"backup.export",
				async (lease) => {
					const archive = await buildBackupArchive(c.env.DB, new Date(), {
						includeAttachments: !!c.req.valid("json")?.includeAttachments,
						blobStore: createBlobStore(c.env),
						checkpoint: () => requireFreshDataOperationLease(c.env.DB, lease),
					});
					await safeWriteAuditEvent(c.get("db"), {
						actorUserId: c.get("user").id,
						action: "backup.exported",
						category: "system",
						targetType: "backup",
						targetId: archive.fileName,
						metadata: { fileName: archive.fileName, status: "success" },
					});
					return new Response(archive.bytes, {
						status: 200,
						headers: {
							"Content-Type": "application/zip",
							"Content-Disposition": `attachment; filename="${archive.fileName}"`,
							"Cache-Control": "no-store",
						},
					});
				},
			);
		} catch (error: unknown) {
			const message = backupErrorMessage(error, "Backup export failed");
			return errorResponse(
				message,
				message.includes("operation is running") ? 409 : 500,
			);
		}
	},
);

export const getBackupBlob = factory.createHandlers(
	vValidator("query", BackupBlobQuerySchema),
	async (c) => {
		const blobStore = createBlobStore(c.env);
		if (!blobStore) {
			return errorResponse("Attachment storage is not configured", 409);
		}
		try {
			const blobName = ensureBackupBlobName(c.req.valid("query").blobName);
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
		} catch (error: unknown) {
			return errorResponse(
				backupErrorMessage(error, "Backup attachment download failed"),
				400,
			);
		}
	},
);

export const getBackupSettings = factory.createHandlers(async (c) => {
	try {
		return c.json(
			await loadBackupSettings(
				c.get("db"),
				c.env.DATA_ENCRYPTION_SECRET,
				"UTC",
			),
		);
	} catch (error: unknown) {
		return errorResponse(
			backupErrorMessage(error, "Backup settings could not be loaded"),
			409,
		);
	}
});

export const updateBackupSettings = factory.createHandlers(
	vValidator("json", BackupSettingsSchema),
	async (c) => {
		try {
			const previous = await loadBackupSettings(
				c.get("db"),
				c.env.DATA_ENCRYPTION_SECRET,
				"UTC",
			);
			const normalized = normalizeBackupSettingsInput(
				c.req.valid("json"),
				previous,
			);
			await saveBackupSettings(
				c.get("db"),
				c.env.DATA_ENCRYPTION_SECRET,
				normalized,
			);
			return c.json(normalized);
		} catch (error: unknown) {
			return errorResponse(
				backupErrorMessage(error, "Backup settings save failed"),
				400,
			);
		}
	},
);

export const runBackup = factory.createHandlers(
	vValidator("json", BackupRunSchema),
	async (c) => {
		const db = c.get("db");
		const secret = c.env.DATA_ENCRYPTION_SECRET;
		const destinationId = c.req.valid("json").destinationId;
		const lease = await acquireDataOperationLease(c.env.DB, "backup.manual");
		if (!lease) {
			return errorResponse(
				"Another backup, restore, or maintenance operation is running",
				409,
			);
		}
		try {
			const blobStore = createBlobStore(c.env);
			const settings = await loadBackupSettings(db, secret, "UTC");
			const destination = requireBackupDestination(settings, destinationId);
			const date = new Date();
			destination.runtime.lastAttemptAt = date.toISOString();
			destination.runtime.lastAttemptLocalDate = getBackupLocalDateKey(
				date,
				destination.schedule.timezone,
			);
			destination.runtime.lastErrorAt = null;
			destination.runtime.lastErrorMessage = null;
			await saveBackupSettings(db, secret, settings);

			const archive = await buildBackupArchive(c.env.DB, date, {
				includeAttachments: destination.includeAttachments,
				blobStore,
				checkpoint: () => requireFreshDataOperationLease(c.env.DB, lease),
				timeZone: destination.schedule.timezone,
			});
			await requireDataOperationLeaseRenewal(c.env.DB, lease);
			const remoteSession = createRemoteBackupTransferSession(destination);
			const upload = await remoteSession.uploadArchive(
				archive.bytes,
				archive.fileName,
			);
			await requireDataOperationLeaseRenewal(c.env.DB, lease);
			const remoteFile = await remoteSession.download(archive.fileName);
			await assertBackupArchiveIntegrity(
				remoteFile.bytes,
				archive.fileName,
				archive.bytes.byteLength,
			);
			await requireDataOperationLeaseRenewal(c.env.DB, lease);

			let prunedCount = 0;
			if (destination.schedule.retentionCount !== null) {
				prunedCount = await pruneRemoteBackupArchives(
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
			await saveBackupSettings(db, secret, settings);
			await safeWriteAuditEvent(db, {
				actorUserId: c.get("user").id,
				action: "backup.uploaded",
				category: "system",
				targetType: "backup-destination",
				targetId: destination.id,
				metadata: {
					fileName: archive.fileName,
					status: "success",
					type: destination.type,
				},
			});
			return c.json({
				result: {
					fileName: archive.fileName,
					fileSize: archive.bytes.byteLength,
					remotePath: upload.remotePath,
					provider: upload.provider,
					prunedCount,
				},
				settings,
			});
		} catch (error: unknown) {
			const message = backupErrorMessage(error, "Backup upload failed");
			const settings = await loadBackupSettings(db, secret, "UTC").catch(
				() => null,
			);
			if (settings) {
				const destination = requireBackupDestination(settings, destinationId);
				destination.runtime.lastErrorAt = new Date().toISOString();
				destination.runtime.lastErrorMessage = message;
				await saveBackupSettings(db, secret, settings).catch(() => null);
			}
			return errorResponse(message, 500);
		} finally {
			await releaseDataOperationLease(c.env.DB, lease).catch(() => undefined);
		}
	},
);

export const importBackup = factory.createHandlers(
	vValidator("form", BackupImportSchema),
	async (c) => {
		const body = c.req.valid("form");
		const file = body.file as File;
		let archiveBytes: Uint8Array;
		try {
			archiveBytes = new Uint8Array(await file.arrayBuffer());
		} catch {
			return errorResponse("Unable to read backup file", 400);
		}
		const lease = await acquireDataOperationLease(c.env.DB, "backup.restore");
		if (!lease) {
			return errorResponse(
				"Another backup, restore, or maintenance operation is running",
				409,
			);
		}

		try {
			const fileName = String(file.name || "");
			const checksumOk = await verifyBackupArchiveFileNameChecksum(
				archiveBytes,
				fileName,
			);
			if (!checksumOk && body.allowChecksumMismatch !== "1") {
				return errorResponse(
					"Backup file checksum does not match its filename",
					400,
				);
			}
			const imported = await importBackupArchiveBytes(
				archiveBytes,
				c.env.DB,
				createBlobStore(c.env),
				c.env.DATA_ENCRYPTION_SECRET,
				c.get("user").id,
				body.replaceExisting === "1",
				async () => requireDataOperationLeaseRenewal(c.env.DB, lease),
				fileName || "edgewarden_backup.zip",
			);
			await safeWriteAuditEvent(c.get("db"), {
				actorUserId: imported.auditActorUserId,
				action: "backup.restored",
				category: "system",
				level: "warning",
				targetType: "backup",
				targetId: fileName || null,
				metadata: { fileName: fileName || null, status: "success" },
			});
			return c.json(imported.result);
		} catch (error: unknown) {
			const message = backupErrorMessage(error, "Backup import failed");
			return errorResponse(
				message,
				message.includes("requires a fresh instance") ? 409 : 500,
			);
		} finally {
			await releaseDataOperationLease(c.env.DB, lease).catch(() => undefined);
		}
	},
);

export {
	deleteRemoteBackup,
	downloadRemoteBackup,
	inspectRemoteBackup,
	listRemoteBackups,
	restoreRemoteBackup,
} from "./backup-remote";
