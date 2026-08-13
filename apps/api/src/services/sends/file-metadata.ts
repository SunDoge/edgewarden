export interface StoredSendFileMetadata {
	fileId: string;
	sizeBytes: number;
}

/** Parse current camelCase and legacy Bitwarden PascalCase file metadata. */
export function parseStoredSendFileMetadata(
	value: unknown,
): StoredSendFileMetadata | null {
	try {
		const data = JSON.parse(String(value || "")) as {
			id?: unknown;
			Id?: unknown;
			size?: unknown;
			Size?: unknown;
		};
		const rawFileId = data.id ?? data.Id;
		const fileId = typeof rawFileId === "string" ? rawFileId.trim() : "";
		const sizeBytes = Number(data.size ?? data.Size);
		return fileId && Number.isSafeInteger(sizeBytes) && sizeBytes >= 0
			? { fileId, sizeBytes }
			: null;
	} catch {
		return null;
	}
}
