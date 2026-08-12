const BACKUP_FILE_HASH_PREFIX_LENGTH = 5;

export interface BackupFileIntegrityCheckResult {
	hasChecksumPrefix: boolean;
	expectedPrefix: string | null;
	actualPrefix: string;
	matches: boolean;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function getBackupArchiveChecksumPrefix(
	bytes: Uint8Array,
): Promise<string> {
	return (await sha256Hex(bytes)).slice(0, BACKUP_FILE_HASH_PREFIX_LENGTH);
}

function getDateParts(date: Date, timeZone: string): string {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const parts = formatter.formatToParts(date);
	const pick = (type: string): string =>
		parts.find((part) => part.type === type)?.value || "";
	return `${pick("year")}${pick("month")}${pick("day")}_${pick("hour")}${pick("minute")}${pick("second")}`;
}

export function buildBackupFileNameInTimeZone(
	date: Date = new Date(),
	checksumPrefix: string | null = null,
	timeZone = "UTC",
): string {
	const parts = getDateParts(date, timeZone);
	const suffix = checksumPrefix ? `_${checksumPrefix}` : "";
	return `edgewarden_backup_${parts}${suffix}.zip`;
}

export function extractBackupFileChecksumPrefix(
	fileName: string,
): string | null {
	const normalized = String(fileName || "").trim();
	const match = normalized.match(/_([0-9a-f]{5})\.zip$/i);
	return match ? match[1].toLowerCase() : null;
}

export async function inspectBackupArchiveFileNameChecksum(
	bytes: Uint8Array,
	fileName: string,
): Promise<BackupFileIntegrityCheckResult> {
	const expectedPrefix = extractBackupFileChecksumPrefix(fileName);
	const actualPrefix = await getBackupArchiveChecksumPrefix(bytes);
	return {
		hasChecksumPrefix: !!expectedPrefix,
		expectedPrefix,
		actualPrefix,
		matches: !expectedPrefix || actualPrefix === expectedPrefix,
	};
}

export async function verifyBackupArchiveFileNameChecksum(
	bytes: Uint8Array,
	fileName: string,
): Promise<boolean> {
	const result = await inspectBackupArchiveFileNameChecksum(bytes, fileName);
	return result.matches;
}
