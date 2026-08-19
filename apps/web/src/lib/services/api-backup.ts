import type { InferRequestType } from "hono/client";
import { rpc, rpcJson, rpcVoid } from "./rpc";
import type {
  BackupImportResult,
  BackupIntegrityResult,
  BackupRunResult,
  BackupSettings,
  RemoteBackupListResult,
} from "./backup-types";

export async function fetchBackupSettingsApi(): Promise<BackupSettings> {
  return (await rpcJson(
    await rpc.api.admin.backup.settings.$get(),
  )) as BackupSettings;
}

export async function updateBackupSettingsApi(
  settings: BackupSettings,
): Promise<BackupSettings> {
  return (await rpcJson(
    await rpc.api.admin.backup.settings.$put({
      json: settings as unknown as InferRequestType<
        typeof rpc.api.admin.backup.settings.$put
      >["json"],
    }),
  )) as BackupSettings;
}

export async function runBackupApi(
  destinationId?: string | null,
): Promise<BackupRunResult> {
  return (await rpcJson(
    await rpc.api.admin.backup.run.$post({
      json: { destinationId: destinationId ?? undefined },
    }),
  )) as BackupRunResult;
}

export async function listRemoteBackupsApi(
  destinationId: string,
  path: string,
): Promise<RemoteBackupListResult> {
  return (await rpcJson(
    await rpc.api.admin.backup.remote.$get({
      query: { destinationId, path },
    }),
  )) as RemoteBackupListResult;
}

export async function downloadRemoteBackupApi(
  destinationId: string,
  path: string,
): Promise<Blob> {
  return (
    await rpc.api.admin.backup.remote.download.$get({
      query: { destinationId, path },
    })
  ).blob();
}

export async function inspectRemoteBackupApi(
  destinationId: string,
  path: string,
): Promise<BackupIntegrityResult> {
  return (await rpcJson(
    await rpc.api.admin.backup.remote.integrity.$get({
      query: { destinationId, path },
    }),
  )) as BackupIntegrityResult;
}

export async function deleteRemoteBackupApi(
  destinationId: string,
  path: string,
): Promise<void> {
  rpcVoid(
    await rpc.api.admin.backup.remote.file.$delete({
      query: { destinationId, path },
    }),
  );
}

export async function restoreRemoteBackupApi(
  destinationId: string,
  path: string,
  replaceExisting: boolean,
  allowChecksumMismatch: boolean,
): Promise<BackupImportResult> {
  return (await rpcJson(
    await rpc.api.admin.backup.remote.restore.$post({
      json: {
        destinationId,
        path,
        replaceExisting,
        allowChecksumMismatch,
      },
    }),
  )) as BackupImportResult;
}

export async function importBackupLocalApi(
  file: File,
  replaceExisting: boolean,
  allowChecksumMismatch: boolean,
): Promise<BackupImportResult> {
  return (await rpcJson(
    await rpc.api.admin.backup.import.$post({
      form: {
        file,
        replaceExisting: replaceExisting ? "1" : "0",
        allowChecksumMismatch: allowChecksumMismatch ? "1" : "0",
      },
    }),
  )) as BackupImportResult;
}

export async function exportBackupLocalApi(
  includeAttachments: boolean,
): Promise<Blob> {
  return (
    await rpc.api.admin.backup.export.$post({ json: { includeAttachments } })
  ).blob();
}
