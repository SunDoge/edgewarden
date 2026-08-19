import { BACKUP_R2_ROOT_PATH } from "@edgewarden/shared";
import { MAX_BACKUP_ARCHIVE_BYTES } from "./limits";
import type {
  RemoteBackupFile,
  RemoteBackupFilePutOptions,
  RemoteBackupItem,
  RemoteBackupListResult,
} from "./remote-types";
import {
  basename,
  buildJoinedPath,
  normalizeRelativePath,
  parentPath,
  sortRemoteItems,
} from "./remote-utils";

export interface R2BackupBucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

function objectKey(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) throw new Error("R2 backup path is required");
  return buildJoinedPath(BACKUP_R2_ROOT_PATH, normalized);
}

export async function putToR2(
  bucket: R2BackupBucket,
  relativePath: string,
  bytes: Uint8Array,
  options: RemoteBackupFilePutOptions = {},
): Promise<void> {
  await bucket.put(objectKey(relativePath), bytes, {
    httpMetadata: {
      contentType: options.contentType || "application/octet-stream",
    },
  });
}

export async function listR2Entries(
  bucket: R2BackupBucket,
  relativePath: string,
): Promise<RemoteBackupListResult> {
  const currentPath = normalizeRelativePath(relativePath);
  const prefix = `${buildJoinedPath(BACKUP_R2_ROOT_PATH, currentPath)}/`;
  const items: RemoteBackupItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix,
      delimiter: "/",
      cursor,
      include: ["httpMetadata"],
    });
    for (const directoryPrefix of page.delimitedPrefixes) {
      const path = directoryPrefix.slice(prefix.length).replace(/\/$/, "");
      if (!path || path.includes("/")) continue;
      items.push({
        path: buildJoinedPath(currentPath, path),
        name: path,
        isDirectory: true,
        size: null,
        modifiedAt: null,
      });
    }
    for (const object of page.objects) {
      const name = object.key.slice(prefix.length);
      if (!name || name.includes("/")) continue;
      items.push({
        path: buildJoinedPath(currentPath, name),
        name,
        isDirectory: false,
        size: object.size,
        modifiedAt: object.uploaded.toISOString(),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return {
    provider: "r2",
    currentPath,
    parentPath: parentPath(currentPath),
    items: sortRemoteItems(items),
  };
}

export async function downloadFromR2(
  bucket: R2BackupBucket,
  relativePath: string,
): Promise<RemoteBackupFile> {
  const key = objectKey(relativePath);
  const object = await bucket.get(key);
  if (!object) throw new Error("R2 backup file was not found");
  if (object.size > MAX_BACKUP_ARCHIVE_BYTES) {
    throw new Error("R2 backup file exceeds the restore size limit");
  }
  return {
    provider: "r2",
    remotePath: key,
    fileName: basename(relativePath),
    contentType: object.httpMetadata?.contentType || "application/octet-stream",
    bytes: new Uint8Array(await object.arrayBuffer()),
  };
}

export async function deleteFromR2(
  bucket: R2BackupBucket,
  relativePath: string,
): Promise<void> {
  await bucket.delete(objectKey(relativePath));
}

export async function existsInR2(
  bucket: R2BackupBucket,
  relativePath: string,
): Promise<boolean> {
  return (await bucket.head(objectKey(relativePath))) !== null;
}
