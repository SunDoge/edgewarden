import type { WebDavBackupDestination } from "./config";
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

	const xml = await response.text();
	const rootFullPath = trimSlashes(config.remotePath);
	const items: RemoteBackupItem[] = [];
	for (const block of extractXmlBlocks(xml, "response")) {
		const href = extractXmlFirst(block, "href");
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

		const resourceTypeBlock = extractXmlFirst(block, "resourcetype") || "";
		const isDirectory = /<(?:[^:>]+:)?collection\b/i.test(resourceTypeBlock);
		const sizeRaw = extractXmlFirst(block, "getcontentlength");
		const modifiedAtRaw = extractXmlFirst(block, "getlastmodified");
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
		bytes: new Uint8Array(await response.arrayBuffer()),
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
	});
	if (response.status === 404) return false;
	if (!response.ok) {
		throw new Error(`WebDAV existence check failed: ${response.status}`);
	}
	return true;
}
