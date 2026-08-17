import { XMLParser, XMLValidator } from "fast-xml-parser";
import * as v from "valibot";
import type { WebDavBackupDestination } from "./config";
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
	normalizeRelativePath,
	parentPath,
	parseHttpDate,
	sortRemoteItems,
	trimSlashes,
} from "./remote-utils";

const XmlObjectSchema = v.record(v.string(), v.unknown());

function asXmlObject(value: unknown): Record<string, unknown> | null {
	const result = v.safeParse(XmlObjectSchema, value);
	return result.success ? result.output : null;
}

function asXmlArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function xmlText(value: unknown): string | null {
	if (typeof value === "string" || typeof value === "number") {
		return String(value).trim() || null;
	}
	const object = asXmlObject(value);
	return object ? xmlText(object["#text"]) : null;
}

function isSuccessfulPropStat(propStat: Record<string, unknown>): boolean {
	const status = xmlText(propStat.status);
	return !status || /\s2\d\d(?:\s|$)/.test(status);
}

function responseProperties(
	response: Record<string, unknown>,
): Record<string, unknown> {
	for (const value of asXmlArray(response.propstat)) {
		const propStat = asXmlObject(value);
		if (!propStat || !isSuccessfulPropStat(propStat)) continue;
		const properties = asXmlObject(propStat.prop);
		if (properties) return properties;
	}
	return asXmlObject(response.prop) || {};
}

function parseWebDavResponses(xml: string): Record<string, unknown>[] {
	if (XMLValidator.validate(xml) !== true) {
		throw new Error("WebDAV listing returned invalid XML");
	}
	// Keep parser state request-local; Worker isolates may process overlapping requests.
	const parser = new XMLParser({
		ignoreAttributes: false,
		maxNestedTags: 64,
		processEntities: {
			enabled: true,
			maxEntityCount: 32,
			maxEntitySize: 1_024,
			maxExpandedLength: 64 * 1_024,
			maxTotalExpansions: 256,
		},
		parseTagValue: false,
		removeNSPrefix: true,
		trimValues: true,
		isArray: (tagName) => tagName === "response" || tagName === "propstat",
	});
	let parsed: unknown;
	try {
		parsed = parser.parse(xml) as unknown;
	} catch (error) {
		throw new Error("WebDAV listing returned invalid XML", { cause: error });
	}
	const document = asXmlObject(parsed);
	const multiStatus = document ? asXmlObject(document.multistatus) : null;
	if (!multiStatus) throw new Error("WebDAV listing returned invalid XML");
	return asXmlArray(multiStatus.response).flatMap((value) => {
		const response = asXmlObject(value);
		return response ? [response] : [];
	});
}

function toBasicAuthHeader(username: string, password: string): string {
	const token = btoa(`${username}:${password}`);
	return `Basic ${token}`;
}

function buildWebDavUrl(baseUrl: string, relativePath: string): string {
	const trimmedBase = baseUrl.replace(/\/+$/, "");
	const normalized = normalizeRelativePath(relativePath);
	return normalized
		? `${trimmedBase}/${encodePathSegments(normalized)}`
		: trimmedBase;
}

function webDavFullPath(
	config: WebDavBackupDestination,
	relativePath: string,
): string {
	return buildJoinedPath(
		config.remotePath,
		normalizeRelativePath(relativePath),
	);
}

async function ensureWebDavDirectory(
	baseUrl: string,
	directoryPath: string,
	authHeader: string,
): Promise<void> {
	const segments = trimSlashes(directoryPath).split("/").filter(Boolean);
	let current = "";
	for (const segment of segments) {
		current = buildJoinedPath(current, segment);
		const url = buildWebDavUrl(baseUrl, current);
		const response = await fetch(url, {
			method: "MKCOL",
			headers: {
				Authorization: authHeader,
			},
			signal: AbortSignal.timeout(REMOTE_METADATA_TIMEOUT_MS),
		});
		if ([200, 201, 204, 301, 302, 405].includes(response.status)) continue;
		throw new Error(`WebDAV directory creation failed: ${response.status}`);
	}
}

async function ensureWebDavDirectoryCached(
	baseUrl: string,
	directoryPath: string,
	authHeader: string,
	ensuredDirectories: Set<string>,
): Promise<void> {
	const segments = trimSlashes(directoryPath).split("/").filter(Boolean);
	let current = "";
	for (const segment of segments) {
		current = buildJoinedPath(current, segment);
		if (ensuredDirectories.has(current)) continue;
		const url = buildWebDavUrl(baseUrl, current);
		const response = await fetch(url, {
			method: "MKCOL",
			headers: {
				Authorization: authHeader,
			},
			signal: AbortSignal.timeout(REMOTE_METADATA_TIMEOUT_MS),
		});
		if ([200, 201, 204, 301, 302, 405].includes(response.status)) {
			ensuredDirectories.add(current);
			continue;
		}
		throw new Error(`WebDAV directory creation failed: ${response.status}`);
	}
}

export async function putToWebDav(
	config: WebDavBackupDestination,
	relativePath: string,
	bytes: Uint8Array,
	options: RemoteBackupFilePutOptions = {},
	ensuredDirectories?: Set<string>,
): Promise<void> {
	const authHeader = toBasicAuthHeader(config.username, config.password);
	const remoteFilePath = buildJoinedPath(config.remotePath, relativePath);
	const remoteDir = parentPath(remoteFilePath);

	if (remoteDir) {
		if (ensuredDirectories) {
			await ensureWebDavDirectoryCached(
				config.baseUrl,
				remoteDir,
				authHeader,
				ensuredDirectories,
			);
		} else {
			await ensureWebDavDirectory(config.baseUrl, remoteDir, authHeader);
		}
	}

	const response = await fetch(buildWebDavUrl(config.baseUrl, remoteFilePath), {
		method: "PUT",
		headers: {
			Authorization: authHeader,
			"Content-Type": options.contentType || "application/octet-stream",
			"Content-Length": String(bytes.byteLength),
		},
		body: bytes,
		signal: AbortSignal.timeout(REMOTE_TRANSFER_TIMEOUT_MS),
	});

	if (!response.ok) {
		throw new Error(`WebDAV upload failed: ${response.status}`);
	}
}

export async function uploadToWebDav(
	config: WebDavBackupDestination,
	archive: Uint8Array,
	fileName: string,
): Promise<BackupUploadResult> {
	await putToWebDav(config, fileName, archive, {
		contentType: "application/zip",
	});
	return {
		provider: "webdav",
		remotePath: buildJoinedPath(config.remotePath, fileName),
	};
}

function parseWebDavResponsePath(baseUrl: string, href: string): string {
	const base = new URL(baseUrl);
	const target = new URL(href, base);
	const basePath = trimSlashes(decodeURIComponent(base.pathname));
	const entryPath = trimSlashes(decodeURIComponent(target.pathname));
	if (!basePath) return entryPath;
	if (entryPath === basePath) return "";
	return entryPath.startsWith(`${basePath}/`)
		? entryPath.slice(basePath.length + 1)
		: entryPath;
}

export async function listWebDavEntries(
	config: WebDavBackupDestination,
	relativePath: string,
): Promise<RemoteBackupListResult> {
	const currentPath = normalizeRelativePath(relativePath);
	const targetFullPath = webDavFullPath(config, currentPath);
	const authHeader = toBasicAuthHeader(config.username, config.password);
	const response = await fetch(buildWebDavUrl(config.baseUrl, targetFullPath), {
		method: "PROPFIND",
		headers: {
			Authorization: authHeader,
			Depth: "1",
			"Content-Type": "application/xml; charset=utf-8",
		},
		body: '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/><getlastmodified/></prop></propfind>',
		signal: AbortSignal.timeout(REMOTE_METADATA_TIMEOUT_MS),
	});
	if (response.status === 404) {
		return {
			provider: "webdav",
			currentPath,
			parentPath: parentPath(currentPath),
			items: [],
		};
	}
	if (!response.ok) {
		throw new Error(`WebDAV listing failed: ${response.status}`);
	}

	const xml = await readBoundedResponseText(
		response,
		MAX_REMOTE_LISTING_BYTES,
		"WebDAV listing",
	);
	const rootFullPath = trimSlashes(config.remotePath);
	const items: RemoteBackupItem[] = [];
	for (const responseEntry of parseWebDavResponses(xml)) {
		const href = xmlText(responseEntry.href);
		if (!href) continue;
		const fullPath = trimSlashes(parseWebDavResponsePath(config.baseUrl, href));
		if (!fullPath) continue;
		if (fullPath === targetFullPath) continue;
		if (
			rootFullPath &&
			!(fullPath === rootFullPath || fullPath.startsWith(`${rootFullPath}/`))
		)
			continue;
		const relative = rootFullPath
			? fullPath === rootFullPath
				? ""
				: fullPath.slice(rootFullPath.length + 1)
			: fullPath;
		if (!relative) continue;
		const directParent = parentPath(relative);
		if ((directParent || "") !== currentPath) continue;

		const properties = responseProperties(responseEntry);
		const resourceType = asXmlObject(properties.resourcetype);
		const isDirectory = !!resourceType && "collection" in resourceType;
		const sizeRaw = xmlText(properties.getcontentlength);
		const modifiedAtRaw = xmlText(properties.getlastmodified);
		items.push({
			path: relative,
			name: basename(relative) || relative,
			isDirectory,
			size:
				!isDirectory && sizeRaw && Number.isFinite(Number(sizeRaw))
					? Number(sizeRaw)
					: null,
			modifiedAt: modifiedAtRaw ? parseHttpDate(modifiedAtRaw) : null,
		});
	}

	return {
		provider: "webdav",
		currentPath,
		parentPath: parentPath(currentPath),
		items: sortRemoteItems(items),
	};
}

export async function downloadFromWebDav(
	config: WebDavBackupDestination,
	relativePath: string,
): Promise<RemoteBackupFile> {
	const normalized = normalizeRelativePath(relativePath);
	if (!normalized || normalized.endsWith("/")) {
		throw new Error("Please select a backup file");
	}
	const authHeader = toBasicAuthHeader(config.username, config.password);
	const remotePath = webDavFullPath(config, normalized);
	const response = await fetch(buildWebDavUrl(config.baseUrl, remotePath), {
		method: "GET",
		headers: {
			Authorization: authHeader,
		},
		signal: AbortSignal.timeout(REMOTE_TRANSFER_TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`WebDAV download failed: ${response.status}`);
	}
	return {
		provider: "webdav",
		remotePath: normalized,
		fileName: basename(normalized) || "backup.zip",
		contentType: String(
			response.headers.get("Content-Type") || "application/zip",
		).trim(),
		bytes: await readBoundedResponseBytes(
			response,
			MAX_BACKUP_ARCHIVE_BYTES,
			"WebDAV backup download",
		),
	};
}

export async function deleteFromWebDav(
	config: WebDavBackupDestination,
	relativePath: string,
): Promise<void> {
	const authHeader = toBasicAuthHeader(config.username, config.password);
	const remotePath = webDavFullPath(config, relativePath);
	const response = await fetch(buildWebDavUrl(config.baseUrl, remotePath), {
		method: "DELETE",
		headers: {
			Authorization: authHeader,
		},
		signal: AbortSignal.timeout(REMOTE_METADATA_TIMEOUT_MS),
	});
	if (!response.ok && response.status !== 404) {
		throw new Error(`WebDAV delete failed: ${response.status}`);
	}
}

export async function existsInWebDav(
	config: WebDavBackupDestination,
	relativePath: string,
): Promise<boolean> {
	const authHeader = toBasicAuthHeader(config.username, config.password);
	const remotePath = webDavFullPath(config, relativePath);
	const response = await fetch(buildWebDavUrl(config.baseUrl, remotePath), {
		method: "HEAD",
		headers: {
			Authorization: authHeader,
		},
		signal: AbortSignal.timeout(REMOTE_METADATA_TIMEOUT_MS),
	});
	if (response.status === 404) return false;
	if (!response.ok) {
		throw new Error(`WebDAV existence check failed: ${response.status}`);
	}
	return true;
}
