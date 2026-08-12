import { buildAwsV4Authorization, sha256Hex } from "./aws-signature";
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
	basename,
	buildJoinedPath,
	encodePathSegments,
	extractXmlBlocks,
	extractXmlFirst,
	isBackupArchiveName,
	normalizeRelativePath,
	parentPath,
	parseHttpDate,
	sortRemoteItems,
	trimSlashes,
} from "./remote-utils";
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

function isBucketHostedS3Endpoint(endpoint: URL, bucket: string): boolean {
	const hostname = endpoint.hostname.toLowerCase();
	const bucketName = bucket.trim().toLowerCase();
	return (
		!!bucketName &&
		(hostname === bucketName || hostname.startsWith(`${bucketName}.`))
	);
}

function s3BucketBaseUrl(config: S3BackupDestination): URL {
	const endpoint = new URL(config.endpoint.replace(/\/+$/, ""));
	const bucket = config.bucket.trim();

	if (config.addressingStyle === "virtual-hosted-style") {
		if (isBucketHostedS3Endpoint(endpoint, bucket)) return endpoint;
		endpoint.hostname = `${bucket}.${endpoint.hostname}`;
		return endpoint;
	}

	return new URL(
		`${endpoint.toString().replace(/\/+$/, "")}/${encodeURIComponent(bucket)}`,
	);
}

function s3ObjectUrl(config: S3BackupDestination, objectKey: string): URL {
	return new URL(
		`${s3BucketBaseUrl(config).toString().replace(/\/+$/, "")}/${encodePathSegments(objectKey)}`,
	);
}

function normalizeS3ObjectKey(
	config: S3BackupDestination,
	relativePath: string,
): string {
	return buildJoinedPath(config.rootPath, normalizeRelativePath(relativePath));
}

async function signedS3Request(
	config: S3BackupDestination,
	method: "GET" | "PUT" | "DELETE" | "HEAD",
	url: URL,
	body?: Uint8Array,
	contentType?: string,
): Promise<Response> {
	const payloadHashHex = await sha256Hex(body || new Uint8Array());
	const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
	const headers: Record<string, string> = {
		host: url.host,
		"x-amz-content-sha256": payloadHashHex,
		"x-amz-date": amzDate,
	};
	if (method === "PUT")
		headers["content-type"] = contentType || "application/octet-stream";

	const authorization = await buildAwsV4Authorization(
		method,
		url,
		headers,
		payloadHashHex,
		config.accessKeyId,
		config.secretAccessKey,
		config.region || "auto",
	);

	return fetch(url.toString(), {
		method,
		headers: {
			Authorization: authorization,
			"X-Amz-Content-Sha256": headers["x-amz-content-sha256"],
			"X-Amz-Date": headers["x-amz-date"],
			...(method === "PUT" ? { "Content-Type": headers["content-type"] } : {}),
		},
		body,
	});
}

async function putToS3(
	config: S3BackupDestination,
	relativePath: string,
	bytes: Uint8Array,
	options: RemoteBackupFilePutOptions = {},
): Promise<void> {
	const objectKey = normalizeS3ObjectKey(config, relativePath);
	const url = s3ObjectUrl(config, objectKey);
	const response = await signedS3Request(
		config,
		"PUT",
		url,
		bytes,
		options.contentType,
	);

	if (!response.ok) {
		throw new Error(`S3 upload failed: ${response.status}`);
	}
}

async function uploadToS3(
	config: S3BackupDestination,
	archive: Uint8Array,
	fileName: string,
): Promise<BackupUploadResult> {
	await putToS3(config, fileName, archive, {
		contentType: "application/zip",
	});
	return {
		provider: "s3",
		remotePath: normalizeS3ObjectKey(config, fileName),
	};
}

async function listS3Entries(
	config: S3BackupDestination,
	relativePath: string,
): Promise<RemoteBackupListResult> {
	const currentPath = normalizeRelativePath(relativePath);
	const targetPrefixBase = normalizeS3ObjectKey(config, currentPath);
	const targetPrefix = trimSlashes(targetPrefixBase)
		? `${trimSlashes(targetPrefixBase)}/`
		: "";
	const url = s3BucketBaseUrl(config);
	url.searchParams.set("list-type", "2");
	url.searchParams.set("delimiter", "/");
	if (targetPrefix) url.searchParams.set("prefix", targetPrefix);

	const response = await signedS3Request(config, "GET", url);
	if (!response.ok) {
		throw new Error(`S3 listing failed: ${response.status}`);
	}

	const xml = await response.text();
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
		const normalizedRelative = trimSlashes(relative);
		if (!normalizedRelative) continue;
		const itemPath = normalizedRelative.replace(/\/+$/, "");
		if ((parentPath(itemPath) || "") !== currentPath) continue;
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
		const normalizedRelative = trimSlashes(relative);
		if (
			!normalizedRelative ||
			(parentPath(normalizedRelative) || "") !== currentPath
		)
			continue;
		items.push({
			path: normalizedRelative,
			name: basename(normalizedRelative) || normalizedRelative,
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

async function downloadFromS3(
	config: S3BackupDestination,
	relativePath: string,
): Promise<RemoteBackupFile> {
	const normalized = normalizeRelativePath(relativePath);
	if (!normalized || normalized.endsWith("/")) {
		throw new Error("Please select a backup file");
	}
	const objectKey = normalizeS3ObjectKey(config, normalized);
	const url = s3ObjectUrl(config, objectKey);
	const response = await signedS3Request(config, "GET", url);
	if (!response.ok) {
		throw new Error(`S3 download failed: ${response.status}`);
	}
	return {
		provider: "s3",
		remotePath: normalized,
		fileName: basename(normalized) || "backup.zip",
		contentType: String(
			response.headers.get("Content-Type") || "application/zip",
		).trim(),
		bytes: new Uint8Array(await response.arrayBuffer()),
	};
}

async function deleteFromS3(
	config: S3BackupDestination,
	relativePath: string,
): Promise<void> {
	const objectKey = normalizeS3ObjectKey(config, relativePath);
	const url = s3ObjectUrl(config, objectKey);
	const response = await signedS3Request(config, "DELETE", url);
	if (!response.ok && response.status !== 404) {
		throw new Error(`S3 delete failed: ${response.status}`);
	}
}

async function existsInS3(
	config: S3BackupDestination,
	relativePath: string,
): Promise<boolean> {
	const objectKey = normalizeS3ObjectKey(config, relativePath);
	const url = s3ObjectUrl(config, objectKey);
	const response = await signedS3Request(config, "HEAD", url);
	if (response.status === 404) return false;
	if (!response.ok) {
		throw new Error(`S3 existence check failed: ${response.status}`);
	}
	return true;
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
): RemoteBackupTransferSession {
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
): Promise<number> {
	if (retentionCount === null) return 0;
	const adapter = resolveConfiguredDestinationAdapter(destination);
	const listing = await adapter.list(adapter.config, "");
	const backupFiles = listing.items
		.filter((item) => !item.isDirectory && isBackupArchiveName(item.name))
		.sort((a, b) => compareBackupItemsByRecency(a, b, preferredFileName));
	if (backupFiles.length <= retentionCount) return 0;
	for (const item of backupFiles.slice(retentionCount)) {
		await adapter.deleteFile(adapter.config, item.path);
	}
	return backupFiles.length - retentionCount;
}
