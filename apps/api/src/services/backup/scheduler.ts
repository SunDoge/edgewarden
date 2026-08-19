import { D1Dialect } from "@sundoge/kysely-d1";
import { Kysely, sql } from "kysely";
import type { DB } from "../../types/db";
import { safeWriteAuditEvent } from "../audit";
import { createBlobStore, getR2StorageBinding } from "../blob-store";
import { assertBackupArchiveIntegrity, buildBackupArchive } from "./archive";
import {
  getBackupLocalDateKey,
  isBackupDueNow,
  loadBackupSettings,
  saveBackupSettings,
} from "./config";
import {
  acquireDataOperationLease,
  DataOperationLeaseLostError,
  releaseDataOperationLease,
  requireDataOperationLeaseRenewal,
  requireFreshDataOperationLease,
} from "./operation-lease";
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
  busy: boolean;
}

export async function runScheduledBackupIfDue(
  env: CloudflareBindings,
): Promise<ScheduledBackupResult> {
  const db = await createBackupDatabase(env.DB);
  const dataEncryptionSecret = env.DATA_ENCRYPTION_SECRET;
  const blobStore = createBlobStore(env);
  const result: ScheduledBackupResult = {
    due: 0,
    succeeded: 0,
    failed: 0,
    busy: false,
  };
  const lease = await acquireDataOperationLease(env.DB, "backup.scheduled");
  if (!lease) {
    await db.destroy();
    return { ...result, busy: true };
  }
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

        const r2Bucket = getR2StorageBinding(env);
        const session = createRemoteBackupTransferSession(destination, {
          r2Bucket,
        });
        const archive = await buildBackupArchive(env.DB, currentTime, {
          includeAttachments: destination.includeAttachments,
          blobStore,
          externalizeAttachment: async (blobName, bytes) => {
            await session.putFile(blobName, bytes, {
              contentType: "application/octet-stream",
            });
            const uploaded = await session.download(blobName);
            if (
              uploaded.bytes.byteLength !== bytes.byteLength ||
              !uploaded.bytes.every((value, index) => value === bytes[index])
            ) {
              throw new Error(
                `Remote backup blob verification failed: ${blobName}`,
              );
            }
          },
          checkpoint: () => requireFreshDataOperationLease(env.DB, lease),
          timeZone: destination.schedule.timezone,
        });
        await requireDataOperationLeaseRenewal(env.DB, lease);
        const upload = await session.uploadArchive(
          archive.bytes,
          archive.fileName,
        );
        await requireDataOperationLeaseRenewal(env.DB, lease);
        const remoteFile = await session.download(archive.fileName);
        await assertBackupArchiveIntegrity(
          remoteFile.bytes,
          archive.fileName,
          archive.bytes.byteLength,
          { allowExternalAttachmentBlobs: true },
        );
        await requireDataOperationLeaseRenewal(env.DB, lease);

        if (destination.schedule.retentionCount !== null) {
          await pruneRemoteBackupArchives(
            destination,
            destination.schedule.retentionCount,
            archive.fileName,
            { r2Bucket },
          );
        }
        await requireDataOperationLeaseRenewal(env.DB, lease);
        destination.runtime.lastSuccessAt = new Date().toISOString();
        destination.runtime.lastErrorAt = null;
        destination.runtime.lastErrorMessage = null;
        destination.runtime.lastUploadedFileName = archive.fileName;
        destination.runtime.lastUploadedSizeBytes = archive.bytes.byteLength;
        destination.runtime.lastUploadedDestination = upload.remotePath;
        await saveBackupSettings(db, dataEncryptionSecret, settings);
        await safeWriteAuditEvent(db, {
          actorUserId: null,
          action: "backup.scheduled_uploaded",
          category: "system",
          targetType: "backup-destination",
          targetId: destination.id,
          metadata: {
            fileName: archive.fileName,
            status: "success",
            type: destination.type,
          },
        });
        result.succeeded += 1;
      } catch (error: unknown) {
        if (error instanceof DataOperationLeaseLostError) throw error;
        result.failed += 1;
        destination.runtime.lastErrorAt = new Date().toISOString();
        destination.runtime.lastErrorMessage = errorMessage(
          error,
          "Scheduled backup failed",
        );
        await saveBackupSettings(db, dataEncryptionSecret, settings).catch(
          () => null,
        );
        await safeWriteAuditEvent(db, {
          actorUserId: null,
          action: "backup.scheduled_failed",
          category: "system",
          level: "error",
          targetType: "backup-destination",
          targetId: destination.id,
          metadata: {
            status: "failed",
            type: destination.type,
            error: destination.runtime.lastErrorMessage,
          },
        });
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
    await releaseDataOperationLease(env.DB, lease).catch(() => undefined);
    await db.destroy();
  }
}
