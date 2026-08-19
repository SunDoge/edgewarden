import type {
  BackupDestinationRecord,
  BackupDestinationType,
  S3BackupDestination,
  WebDavBackupDestination,
} from "./config";
import type {
  BackupUploadResult,
  RemoteBackupFile,
  RemoteBackupFilePutOptions,
  RemoteBackupItem,
  RemoteBackupListResult,
} from "./remote-types";
import {
  buildJoinedPath,
  isBackupArchiveName,
  normalizeRelativePath,
} from "./remote-utils";
import {
  deleteFromR2,
  downloadFromR2,
  existsInR2,
  listR2Entries,
  putToR2,
  type R2BackupBucket,
} from "./r2-adapter";
import {
  deleteFromS3,
  downloadFromS3,
  existsInS3,
  listS3Entries,
  normalizeS3ObjectKey,
  putToS3,
  uploadToS3,
} from "./s3-adapter";
import {
  deleteFromWebDav,
  downloadFromWebDav,
  existsInWebDav,
  listWebDavEntries,
  putToWebDav,
  uploadToWebDav,
} from "./webdav-adapter";

export type {
  BackupUploadResult,
  RemoteBackupFile,
  RemoteBackupFilePutOptions,
  RemoteBackupItem,
  RemoteBackupListResult,
} from "./remote-types";

function ensureDestinationConfigReady(
  destination: BackupDestinationRecord,
): void {
  if (destination.type === "webdav") {
    const config = destination.destination as WebDavBackupDestination;
    if (!String(config.baseUrl || "").trim())
      throw new Error("WebDAV server URL is required");
    if (!/^https?:\/\//i.test(String(config.baseUrl || "").trim()))
      throw new Error("WebDAV server URL must start with http:// or https://");
    if (!String(config.username || "").trim())
      throw new Error("WebDAV username is required");
    if (!String(config.password || ""))
      throw new Error("WebDAV password is required");
    return;
  }
  if (destination.type === "s3") {
    const config = destination.destination as S3BackupDestination;
    if (!String(config.endpoint || "").trim())
      throw new Error("S3 endpoint is required");
    if (!/^https?:\/\//i.test(String(config.endpoint || "").trim()))
      throw new Error("S3 endpoint must start with http:// or https://");
    if (!String(config.bucket || "").trim())
      throw new Error("S3 bucket is required");
    if (!String(config.accessKeyId || "").trim())
      throw new Error("S3 access key is required");
    if (!String(config.secretAccessKey || ""))
      throw new Error("S3 secret key is required");
  }
}

interface ConfiguredDestinationAdapter {
  provider: "webdav" | "s3";
  config: WebDavBackupDestination | S3BackupDestination;
  upload: (
    config: WebDavBackupDestination | S3BackupDestination,
    archive: Uint8Array,
    fileName: string,
  ) => Promise<BackupUploadResult>;
  putFile: (
    config: WebDavBackupDestination | S3BackupDestination,
    relativePath: string,
    bytes: Uint8Array,
    options?: RemoteBackupFilePutOptions,
  ) => Promise<void>;
  list: (
    config: WebDavBackupDestination | S3BackupDestination,
    relativePath: string,
  ) => Promise<RemoteBackupListResult>;
  download: (
    config: WebDavBackupDestination | S3BackupDestination,
    relativePath: string,
  ) => Promise<RemoteBackupFile>;
  deleteFile: (
    config: WebDavBackupDestination | S3BackupDestination,
    relativePath: string,
  ) => Promise<void>;
  exists: (
    config: WebDavBackupDestination | S3BackupDestination,
    relativePath: string,
  ) => Promise<boolean>;
}

export interface RemoteBackupTransferSession {
  provider: BackupDestinationType;
  uploadArchive(
    archive: Uint8Array,
    fileName: string,
  ): Promise<BackupUploadResult>;
  putFile(
    relativePath: string,
    bytes: Uint8Array,
    options?: RemoteBackupFilePutOptions,
  ): Promise<void>;
  list(relativePath: string): Promise<RemoteBackupListResult>;
  download(relativePath: string): Promise<RemoteBackupFile>;
  deleteFile(relativePath: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
}

export interface RemoteBackupSessionBindings {
  r2Bucket?: R2BackupBucket | null;
}

function createR2TransferSession(
  bucket: R2BackupBucket | null | undefined,
): RemoteBackupTransferSession {
  if (!bucket) {
    throw new Error("R2 backup requires an active ATTACHMENTS_R2 binding");
  }
  return {
    provider: "r2",
    uploadArchive: async (archive, fileName) => {
      await putToR2(bucket, fileName, archive, {
        contentType: "application/zip",
      });
      return { provider: "r2", remotePath: `backups/${fileName}` };
    },
    putFile: (relativePath, bytes, options) =>
      putToR2(bucket, relativePath, bytes, options),
    list: (relativePath) => listR2Entries(bucket, relativePath),
    download: (relativePath) => downloadFromR2(bucket, relativePath),
    deleteFile: (relativePath) => deleteFromR2(bucket, relativePath),
    exists: (relativePath) => existsInR2(bucket, relativePath),
  };
}

function resolveConfiguredDestinationAdapter(
  destination: BackupDestinationRecord,
): ConfiguredDestinationAdapter {
  ensureDestinationConfigReady(destination);

  if (destination.type === "webdav") {
    return {
      provider: "webdav",
      config: destination.destination as WebDavBackupDestination,
      upload: (config, archive, fileName) =>
        uploadToWebDav(config as WebDavBackupDestination, archive, fileName),
      putFile: (config, relativePath, bytes, options) =>
        putToWebDav(
          config as WebDavBackupDestination,
          relativePath,
          bytes,
          options,
        ),
      list: (config, relativePath) =>
        listWebDavEntries(config as WebDavBackupDestination, relativePath),
      download: (config, relativePath) =>
        downloadFromWebDav(config as WebDavBackupDestination, relativePath),
      deleteFile: (config, relativePath) =>
        deleteFromWebDav(config as WebDavBackupDestination, relativePath),
      exists: (config, relativePath) =>
        existsInWebDav(config as WebDavBackupDestination, relativePath),
    };
  }
  if (destination.type === "s3") {
    return {
      provider: "s3",
      config: destination.destination as S3BackupDestination,
      upload: (config, archive, fileName) =>
        uploadToS3(config as S3BackupDestination, archive, fileName),
      putFile: (config, relativePath, bytes, options) =>
        putToS3(config as S3BackupDestination, relativePath, bytes, options),
      list: (config, relativePath) =>
        listS3Entries(config as S3BackupDestination, relativePath),
      download: (config, relativePath) =>
        downloadFromS3(config as S3BackupDestination, relativePath),
      deleteFile: (config, relativePath) =>
        deleteFromS3(config as S3BackupDestination, relativePath),
      exists: (config, relativePath) =>
        existsInS3(config as S3BackupDestination, relativePath),
    };
  }

  throw new Error("Unsupported backup destination type");
}

export function createRemoteBackupTransferSession(
  destination: BackupDestinationRecord,
  bindings: RemoteBackupSessionBindings = {},
): RemoteBackupTransferSession {
  if (destination.type === "r2") {
    return createR2TransferSession(bindings.r2Bucket);
  }
  const adapter = resolveConfiguredDestinationAdapter(destination);
  const ensuredDirectories =
    adapter.provider === "webdav" ? new Set<string>() : null;

  const putFile = async (
    relativePath: string,
    bytes: Uint8Array,
    options: RemoteBackupFilePutOptions = {},
  ): Promise<void> => {
    const normalized = normalizeRelativePath(relativePath);
    if (adapter.provider === "webdav" && ensuredDirectories) {
      await putToWebDav(
        adapter.config as WebDavBackupDestination,
        normalized,
        bytes,
        options,
        ensuredDirectories,
      );
      return;
    }
    await adapter.putFile(adapter.config, normalized, bytes, options);
  };

  return {
    provider: adapter.provider,
    uploadArchive: async (archive: Uint8Array, fileName: string) => {
      await putFile(fileName, archive, { contentType: "application/zip" });
      return {
        provider: adapter.provider,
        remotePath:
          adapter.provider === "webdav"
            ? buildJoinedPath(
                (adapter.config as WebDavBackupDestination).remotePath,
                fileName,
              )
            : normalizeS3ObjectKey(
                adapter.config as S3BackupDestination,
                fileName,
              ),
      };
    },
    putFile,
    list: async (relativePath: string) =>
      adapter.list(adapter.config, relativePath),
    download: async (relativePath: string) =>
      adapter.download(adapter.config, relativePath),
    deleteFile: async (relativePath: string) =>
      adapter.deleteFile(adapter.config, normalizeRelativePath(relativePath)),
    exists: async (relativePath: string) =>
      adapter.exists(adapter.config, normalizeRelativePath(relativePath)),
  };
}

export async function uploadBackupArchive(
  destination: BackupDestinationRecord,
  archive: Uint8Array,
  fileName: string,
): Promise<BackupUploadResult> {
  return createRemoteBackupTransferSession(destination).uploadArchive(
    archive,
    fileName,
  );
}

export async function listRemoteBackupEntries(
  destination: BackupDestinationRecord,
  relativePath: string,
): Promise<RemoteBackupListResult> {
  return createRemoteBackupTransferSession(destination).list(relativePath);
}

export async function downloadRemoteBackupFile(
  destination: BackupDestinationRecord,
  relativePath: string,
): Promise<RemoteBackupFile> {
  return createRemoteBackupTransferSession(destination).download(relativePath);
}

export async function deleteRemoteBackupFile(
  destination: BackupDestinationRecord,
  relativePath: string,
): Promise<void> {
  await createRemoteBackupTransferSession(destination).deleteFile(relativePath);
}

export async function remoteBackupFileExists(
  destination: BackupDestinationRecord,
  relativePath: string,
): Promise<boolean> {
  const normalized = normalizeRelativePath(relativePath);
  return createRemoteBackupTransferSession(destination).exists(normalized);
}

export async function uploadRemoteBackupFile(
  destination: BackupDestinationRecord,
  relativePath: string,
  bytes: Uint8Array,
  options: RemoteBackupFilePutOptions = {},
): Promise<void> {
  const normalized = normalizeRelativePath(relativePath);
  await createRemoteBackupTransferSession(destination).putFile(
    normalized,
    bytes,
    options,
  );
}

function compareBackupItemsByRecency(
  a: RemoteBackupItem,
  b: RemoteBackupItem,
  preferredFileName?: string,
): number {
  if (preferredFileName) {
    const aPreferred = a.name === preferredFileName ? 1 : 0;
    const bPreferred = b.name === preferredFileName ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
  }
  const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0;
  const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0;
  if (aTime !== bTime) return bTime - aTime;
  return b.name.localeCompare(a.name, "en");
}

export async function pruneRemoteBackupArchives(
  destination: BackupDestinationRecord,
  retentionCount: number | null,
  preferredFileName?: string,
  bindings: RemoteBackupSessionBindings = {},
): Promise<number> {
  if (retentionCount === null) return 0;
  const session = createRemoteBackupTransferSession(destination, bindings);
  const listing = await session.list("");
  const backupFiles = listing.items
    .filter((item) => !item.isDirectory && isBackupArchiveName(item.name))
    .sort((a, b) => compareBackupItemsByRecency(a, b, preferredFileName));
  if (backupFiles.length <= retentionCount) return 0;
  for (const item of backupFiles.slice(retentionCount)) {
    await session.deleteFile(item.path);
  }
  return backupFiles.length - retentionCount;
}
