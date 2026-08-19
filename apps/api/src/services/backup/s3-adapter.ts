import { AwsClient } from "aws4fetch";
import type { S3BackupDestination } from "./config";
import {
  MAX_BACKUP_ARCHIVE_BYTES,
  MAX_REMOTE_LISTING_BYTES,
  REMOTE_METADATA_TIMEOUT_MS,
  REMOTE_TRANSFER_TIMEOUT_MS,
} from "./limits";
import {
  readBoundedResponseBytes,
  readBoundedResponseText,
} from "./remote-http";
import type {
  BackupUploadResult,
  RemoteBackupFile,
  RemoteBackupFilePutOptions,
  RemoteBackupItem,
  RemoteBackupListResult,
} from "./remote-types";
import {
  basename,
  buildJoinedPath,
  encodePathSegments,
  extractXmlBlocks,
  extractXmlFirst,
  normalizeRelativePath,
  parentPath,
  parseHttpDate,
  sortRemoteItems,
  trimSlashes,
} from "./remote-utils";

function isBucketHostedEndpoint(endpoint: URL, bucket: string): boolean {
  const hostname = endpoint.hostname.toLowerCase();
  const bucketName = bucket.trim().toLowerCase();
  return (
    !!bucketName &&
    (hostname === bucketName || hostname.startsWith(`${bucketName}.`))
  );
}

function bucketBaseUrl(config: S3BackupDestination): URL {
  const endpoint = new URL(config.endpoint.replace(/\/+$/, ""));
  const bucket = config.bucket.trim();
  if (config.addressingStyle === "virtual-hosted-style") {
    if (isBucketHostedEndpoint(endpoint, bucket)) return endpoint;
    endpoint.hostname = `${bucket}.${endpoint.hostname}`;
    return endpoint;
  }
  return new URL(
    `${endpoint.toString().replace(/\/+$/, "")}/${encodeURIComponent(bucket)}`,
  );
}

function objectUrl(config: S3BackupDestination, objectKey: string): URL {
  return new URL(
    `${bucketBaseUrl(config).toString().replace(/\/+$/, "")}/${encodePathSegments(objectKey)}`,
  );
}

export function normalizeS3ObjectKey(
  config: S3BackupDestination,
  relativePath: string,
): string {
  return buildJoinedPath(config.rootPath, normalizeRelativePath(relativePath));
}

async function signedRequest(
  config: S3BackupDestination,
  method: "GET" | "PUT" | "DELETE" | "HEAD",
  url: URL,
  body?: Uint8Array,
  contentType?: string,
  timeoutMs = REMOTE_METADATA_TIMEOUT_MS,
): Promise<Response> {
  // aws4fetch is built on fetch and Web Crypto, so it works without the much
  // larger AWS SDK in the Workers runtime. Keep retries disabled here because
  // callers decide whether an upload/delete operation is safe to retry.
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region || "auto",
    retries: 0,
  });
  return client.fetch(url, {
    method,
    headers:
      method === "PUT"
        ? { "Content-Type": contentType || "application/octet-stream" }
        : undefined,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function putToS3(
  config: S3BackupDestination,
  relativePath: string,
  bytes: Uint8Array,
  options: RemoteBackupFilePutOptions = {},
): Promise<void> {
  const response = await signedRequest(
    config,
    "PUT",
    objectUrl(config, normalizeS3ObjectKey(config, relativePath)),
    bytes,
    options.contentType,
    REMOTE_TRANSFER_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`S3 upload failed: ${response.status}`);
}

export async function uploadToS3(
  config: S3BackupDestination,
  archive: Uint8Array,
  fileName: string,
): Promise<BackupUploadResult> {
  await putToS3(config, fileName, archive, { contentType: "application/zip" });
  return {
    provider: "s3",
    remotePath: normalizeS3ObjectKey(config, fileName),
  };
}

export async function listS3Entries(
  config: S3BackupDestination,
  relativePath: string,
): Promise<RemoteBackupListResult> {
  const currentPath = normalizeRelativePath(relativePath);
  const targetPrefixBase = normalizeS3ObjectKey(config, currentPath);
  const targetPrefix = trimSlashes(targetPrefixBase)
    ? `${trimSlashes(targetPrefixBase)}/`
    : "";
  const url = bucketBaseUrl(config);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("delimiter", "/");
  if (targetPrefix) url.searchParams.set("prefix", targetPrefix);

  const response = await signedRequest(config, "GET", url);
  if (!response.ok) throw new Error(`S3 listing failed: ${response.status}`);
  const xml = await readBoundedResponseText(
    response,
    MAX_REMOTE_LISTING_BYTES,
    "S3 listing",
  );
  const rootPrefix = trimSlashes(config.rootPath);
  const items: RemoteBackupItem[] = [];

  for (const prefix of extractXmlBlocks(xml, "CommonPrefixes")) {
    const fullPrefix = trimSlashes(extractXmlFirst(prefix, "Prefix") || "");
    if (!fullPrefix) continue;
    const relative = rootPrefix
      ? fullPrefix === rootPrefix
        ? ""
        : fullPrefix.startsWith(`${rootPrefix}/`)
          ? fullPrefix.slice(rootPrefix.length + 1)
          : ""
      : fullPrefix;
    const itemPath = trimSlashes(relative).replace(/\/+$/, "");
    if (!itemPath || (parentPath(itemPath) || "") !== currentPath) continue;
    items.push({
      path: itemPath,
      name: basename(itemPath) || itemPath,
      isDirectory: true,
      size: null,
      modifiedAt: null,
    });
  }

  for (const content of extractXmlBlocks(xml, "Contents")) {
    const fullKey = trimSlashes(extractXmlFirst(content, "Key") || "");
    if (!fullKey || (targetPrefix && fullKey === trimSlashes(targetPrefix)))
      continue;
    const relative = rootPrefix
      ? fullKey.startsWith(`${rootPrefix}/`)
        ? fullKey.slice(rootPrefix.length + 1)
        : ""
      : fullKey;
    const itemPath = trimSlashes(relative);
    if (!itemPath || (parentPath(itemPath) || "") !== currentPath) continue;
    items.push({
      path: itemPath,
      name: basename(itemPath) || itemPath,
      isDirectory: false,
      size: Number(extractXmlFirst(content, "Size") || 0) || null,
      modifiedAt:
        parseHttpDate(extractXmlFirst(content, "LastModified") || "") || null,
    });
  }

  const deduped = new Map<string, RemoteBackupItem>();
  for (const item of items)
    deduped.set(`${item.isDirectory ? "d" : "f"}:${item.path}`, item);
  return {
    provider: "s3",
    currentPath,
    parentPath: parentPath(currentPath),
    items: sortRemoteItems(Array.from(deduped.values())),
  };
}

export async function downloadFromS3(
  config: S3BackupDestination,
  relativePath: string,
): Promise<RemoteBackupFile> {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || normalized.endsWith("/"))
    throw new Error("Please select a backup file");
  const response = await signedRequest(
    config,
    "GET",
    objectUrl(config, normalizeS3ObjectKey(config, normalized)),
    undefined,
    undefined,
    REMOTE_TRANSFER_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`S3 download failed: ${response.status}`);
  return {
    provider: "s3",
    remotePath: normalized,
    fileName: basename(normalized) || "backup.zip",
    contentType: String(
      response.headers.get("Content-Type") || "application/zip",
    ).trim(),
    bytes: await readBoundedResponseBytes(
      response,
      MAX_BACKUP_ARCHIVE_BYTES,
      "S3 backup download",
    ),
  };
}

export async function deleteFromS3(
  config: S3BackupDestination,
  relativePath: string,
): Promise<void> {
  const response = await signedRequest(
    config,
    "DELETE",
    objectUrl(config, normalizeS3ObjectKey(config, relativePath)),
  );
  if (!response.ok && response.status !== 404)
    throw new Error(`S3 delete failed: ${response.status}`);
}

export async function existsInS3(
  config: S3BackupDestination,
  relativePath: string,
): Promise<boolean> {
  const response = await signedRequest(
    config,
    "HEAD",
    objectUrl(config, normalizeS3ObjectKey(config, relativePath)),
  );
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(`S3 existence check failed: ${response.status}`);
  return true;
}
