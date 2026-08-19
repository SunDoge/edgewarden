import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import {
  BackupRemoteFileQuerySchema,
  BackupRemoteQuerySchema,
  BackupRemoteRestoreSchema,
} from "../schemas/backup";
import {
  inspectBackupArchiveFileNameChecksum,
  parseBackupArchive,
  verifyBackupArchiveFileNameChecksum,
} from "../services/backup/archive";
import { importRemoteBackupArchiveBytes } from "../services/backup/import";
import { loadRemoteBackupSession } from "../services/backup/remote-session";
import {
  acquireDataOperationLease,
  releaseDataOperationLease,
  requireDataOperationLeaseRenewal,
} from "../services/backup/operation-lease";
import { createBlobStore } from "../services/blob-store";
import { errorResponse, withErrorResponse } from "../utils/response";

export const listRemoteBackups = factory.createHandlers(
  vValidator("query", BackupRemoteQuerySchema),
  async (c) =>
    withErrorResponse(async () => {
      const { destinationId, path } = c.req.valid("query");
      const { session } = await loadRemoteBackupSession(
        c.get("db"),
        c.env.DATA_ENCRYPTION_SECRET,
        c.env,
        destinationId,
      );
      return c.json(await session.list(path));
    }, "Failed to list remote backups"),
);

export const downloadRemoteBackup = factory.createHandlers(
  vValidator("query", BackupRemoteFileQuerySchema),
  async (c) =>
    withErrorResponse(async () => {
      const { destinationId, path } = c.req.valid("query");
      const { session } = await loadRemoteBackupSession(
        c.get("db"),
        c.env.DATA_ENCRYPTION_SECRET,
        c.env,
        destinationId,
      );
      const file = await session.download(path);
      return new Response(file.bytes, {
        status: 200,
        headers: {
          "Content-Type": file.contentType || "application/zip",
          "Content-Disposition": `attachment; filename="${file.fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }, "Failed to download remote backup"),
);

export const inspectRemoteBackup = factory.createHandlers(
  vValidator("query", BackupRemoteFileQuerySchema),
  async (c) =>
    withErrorResponse(async () => {
      const { destinationId, path } = c.req.valid("query");
      const { session } = await loadRemoteBackupSession(
        c.get("db"),
        c.env.DATA_ENCRYPTION_SECRET,
        c.env,
        destinationId,
      );
      const file = await session.download(path);
      const checksum = await inspectBackupArchiveFileNameChecksum(
        file.bytes,
        file.fileName,
      );
      let archiveError: string | null = null;
      try {
        parseBackupArchive(file.bytes);
      } catch (error) {
        archiveError =
          error instanceof Error ? error.message : "Backup archive is invalid";
      }
      const checksumValid = checksum.hasChecksumPrefix
        ? checksum.matches
        : true;
      return c.json({
        object: "backup-remote-integrity",
        destinationId,
        path,
        fileName: file.fileName,
        integrity: {
          ...checksum,
          valid: checksumValid && archiveError === null,
          reason:
            archiveError ||
            (checksumValid
              ? null
              : "Backup file checksum does not match its filename"),
        },
      });
    }, "Failed to inspect remote backup"),
);

export const deleteRemoteBackup = factory.createHandlers(
  vValidator("query", BackupRemoteFileQuerySchema),
  async (c) =>
    withErrorResponse(async () => {
      const { destinationId, path } = c.req.valid("query");
      const { session } = await loadRemoteBackupSession(
        c.get("db"),
        c.env.DATA_ENCRYPTION_SECRET,
        c.env,
        destinationId,
      );
      await session.deleteFile(path);
      return new Response(null, { status: 204 });
    }, "Failed to delete remote backup file"),
);

export const restoreRemoteBackup = factory.createHandlers(
  vValidator("json", BackupRemoteRestoreSchema),
  async (c) =>
    withErrorResponse(async () => {
      const body = c.req.valid("json");
      const { destinationId, path, replaceExisting, allowChecksumMismatch } =
        body;
      const lease = await acquireDataOperationLease(
        c.env.DB,
        "backup.restore_remote",
      );
      if (!lease) {
        return errorResponse(
          "Another backup, restore, or maintenance operation is running",
          409,
        );
      }
      try {
        const { session } = await loadRemoteBackupSession(
          c.get("db"),
          c.env.DATA_ENCRYPTION_SECRET,
          c.env,
          destinationId,
        );
        const file = await session.download(path);
        await requireDataOperationLeaseRenewal(c.env.DB, lease);
        const checksumOk = await verifyBackupArchiveFileNameChecksum(
          file.bytes,
          file.fileName,
        );
        if (!checksumOk && !allowChecksumMismatch) {
          throw new Error("Backup file checksum does not match its filename");
        }

        const imported = await importRemoteBackupArchiveBytes(
          file.bytes,
          c.env.DB,
          createBlobStore(c.env),
          c.env.DATA_ENCRYPTION_SECRET,
          c.get("user").id,
          !!replaceExisting,
          {
            loadAttachment: async (blobName: string) => {
              const blob = await session.download(blobName);
              await requireDataOperationLeaseRenewal(c.env.DB, lease);
              return blob.bytes;
            },
          },
          async () => requireDataOperationLeaseRenewal(c.env.DB, lease),
          file.fileName,
        );
        return c.json(imported.result);
      } finally {
        await releaseDataOperationLease(c.env.DB, lease).catch(() => undefined);
      }
    }, "Failed to restore remote backup"),
);
