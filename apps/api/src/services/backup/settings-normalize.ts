import {
	BACKUP_DEFAULT_INTERVAL_HOURS,
	BACKUP_DEFAULT_START_TIME,
	BACKUP_DEFAULT_TIMEZONE,
	BACKUP_R2_ROOT_PATH,
	type BackupDestinationConfig,
	type BackupDestinationRecord,
	type BackupDestinationType,
	type BackupRuntimeState,
	type BackupScheduleConfig,
	type BackupSettings,
	createBackupRandomId,
	createDefaultBackupDestinationName,
	createDefaultBackupScheduleConfig,
	createDefaultBackupSettings as createSharedDefaultBackupSettings,
	type S3BackupAddressingStyle,
	type R2BackupDestination,
	type S3BackupDestination,
	type WebDavBackupDestination,
} from "@edgewarden/shared";
import { normalizeBackupStartTime } from "./schedule";

const MAX_BACKUP_DESTINATIONS = 24;

export interface BackupSettingsInput {
	destinations?: unknown;
}

function defaultScheduleConfig(timezone = "UTC"): BackupScheduleConfig {
	return {
		...createDefaultBackupScheduleConfig(assertValidTimeZone(timezone)),
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
	return String(value ?? "").trim();
}

function normalizePath(value: unknown): string {
	return asTrimmedString(value)
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

function assertValidTimeZone(timezone: string): string {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
		return timezone;
	} catch {
		throw new Error("Invalid backup timezone");
	}
}

function normalizeRetentionCount(
	value: unknown,
	fallback: number | null = 30,
): number | null {
	if (value === undefined) return fallback;
	if (value === null || String(value).trim() === "") return null;
	const count = Number(value);
	if (!Number.isInteger(count) || count < 1 || count > 1000) {
		throw new Error("Backup retention count must be between 1 and 1000");
	}
	return count;
}

function normalizeIntervalHours(
	value: unknown,
	fallback = BACKUP_DEFAULT_INTERVAL_HOURS,
): number {
	const raw =
		value === undefined || value === null || value === ""
			? fallback
			: Number(value);
	if (!Number.isInteger(raw) || raw < 1 || raw > 99) {
		throw new Error("Backup interval hours must be between 1 and 99");
	}
	return raw;
}

function normalizeS3Destination(
	value: unknown,
	allowIncomplete = false,
): S3BackupDestination {
	const source = isPlainObject(value) ? value : {};
	const endpoint = asTrimmedString(source.endpoint);
	const bucket = asTrimmedString(source.bucket);
	const addressingStyleRaw = asTrimmedString(source.addressingStyle);
	const addressingStyle: S3BackupAddressingStyle =
		addressingStyleRaw === "virtual-hosted-style"
			? "virtual-hosted-style"
			: "path-style";
	const accessKeyId = asTrimmedString(source.accessKeyId);
	const secretAccessKey = asTrimmedString(source.secretAccessKey);
	const region = asTrimmedString(source.region) || "auto";
	const rootPath = normalizePath(source.rootPath);

	if (!allowIncomplete || endpoint) {
		if (!endpoint) throw new Error("S3 endpoint is required");
		if (!/^https?:\/\//i.test(endpoint))
			throw new Error("S3 endpoint must start with http:// or https://");
	}
	if (!allowIncomplete || bucket) {
		if (!bucket) throw new Error("S3 bucket is required");
	}
	if (!allowIncomplete || accessKeyId) {
		if (!accessKeyId) throw new Error("S3 access key is required");
	}
	if (!allowIncomplete || secretAccessKey) {
		if (!secretAccessKey) throw new Error("S3 secret key is required");
	}

	return {
		endpoint: endpoint ? endpoint.replace(/\/+$/, "") : "",
		bucket,
		addressingStyle,
		region,
		accessKeyId,
		secretAccessKey,
		rootPath,
	};
}

function normalizeWebDavDestination(
	value: unknown,
	allowIncomplete = false,
): WebDavBackupDestination {
	const source = isPlainObject(value) ? value : {};
	const baseUrl = asTrimmedString(source.baseUrl);
	const username = asTrimmedString(source.username);
	const password = String(source.password ?? "");
	const remotePath = normalizePath(source.remotePath);

	if (!allowIncomplete || baseUrl) {
		if (!baseUrl) throw new Error("WebDAV server URL is required");
		if (!/^https?:\/\//i.test(baseUrl))
			throw new Error("WebDAV server URL must start with http:// or https://");
	}
	if (!allowIncomplete || username) {
		if (!username) throw new Error("WebDAV username is required");
	}
	if (!allowIncomplete || password) {
		if (!password) throw new Error("WebDAV password is required");
	}

	return {
		baseUrl: baseUrl ? baseUrl.replace(/\/+$/, "") : "",
		username,
		password,
		remotePath,
	};
}

function normalizeDestination(
	destinationType: BackupDestinationType,
	destination: unknown,
	allowIncomplete = false,
): BackupDestinationConfig {
	if (destinationType === "r2") {
		return { rootPath: BACKUP_R2_ROOT_PATH } satisfies R2BackupDestination;
	}
	if (destinationType === "s3")
		return normalizeS3Destination(destination, allowIncomplete);
	return normalizeWebDavDestination(destination, allowIncomplete);
}

function normalizeRuntime(value: unknown): BackupRuntimeState {
	const source = isPlainObject(value) ? value : {};
	const asIso = (input: unknown): string | null => {
		const raw = asTrimmedString(input);
		if (!raw) return null;
		const date = new Date(raw);
		return Number.isFinite(date.getTime()) ? date.toISOString() : null;
	};
	const asMaybeNumber = (input: unknown): number | null => {
		if (input === null || input === undefined || input === "") return null;
		const n = Number(input);
		return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
	};
	return {
		lastAttemptAt: asIso(source.lastAttemptAt),
		lastAttemptLocalDate: asTrimmedString(source.lastAttemptLocalDate) || null,
		lastSuccessAt: asIso(source.lastSuccessAt),
		lastErrorAt: asIso(source.lastErrorAt),
		lastErrorMessage: asTrimmedString(source.lastErrorMessage) || null,
		lastUploadedFileName: asTrimmedString(source.lastUploadedFileName) || null,
		lastUploadedSizeBytes: asMaybeNumber(source.lastUploadedSizeBytes),
		lastUploadedDestination:
			asTrimmedString(source.lastUploadedDestination) || null,
	};
}

function defaultDestinationName(
	type: BackupDestinationType,
	index: number,
): string {
	return createDefaultBackupDestinationName(type, index);
}

function getDestinationType(raw: unknown): BackupDestinationType {
	const value = asTrimmedString(raw);
	if (value === "e3") return "s3";
	if (value === "r2" || value === "s3" || value === "webdav") return value;
	throw new Error("Backup destination type is invalid");
}

function normalizeDestinationRecord(
	input: unknown,
	previousById: Map<string, BackupDestinationRecord>,
	index: number,
	fallbackTimezone: string,
): BackupDestinationRecord {
	if (!isPlainObject(input)) {
		throw new Error("Backup destination is invalid");
	}

	const id = asTrimmedString(input.id) || createBackupRandomId();
	const type = getDestinationType(input.type);
	const previous = previousById.get(id);
	const runtime = previous?.runtime
		? normalizeRuntime(previous.runtime)
		: normalizeRuntime(input.runtime);
	const name =
		asTrimmedString(input.name) ||
		previous?.name ||
		defaultDestinationName(type, index + 1);
	const scheduleSource = isPlainObject(input.schedule) ? input.schedule : {};
	const previousSchedule =
		previous?.schedule || defaultScheduleConfig(fallbackTimezone);
	const retentionSource = Object.hasOwn(scheduleSource, "retentionCount")
		? scheduleSource.retentionCount
		: previousSchedule.retentionCount;
	const schedule: BackupScheduleConfig = {
		enabled: !!(scheduleSource.enabled ?? previousSchedule.enabled),
		intervalHours: normalizeIntervalHours(
			scheduleSource.intervalHours ?? previousSchedule.intervalHours,
			previousSchedule.intervalHours || BACKUP_DEFAULT_INTERVAL_HOURS,
		),
		startTime: normalizeBackupStartTime(
			scheduleSource.startTime ?? previousSchedule.startTime,
			previousSchedule.startTime || BACKUP_DEFAULT_START_TIME,
		),
		timezone: assertValidTimeZone(
			asTrimmedString(scheduleSource.timezone ?? previousSchedule.timezone) ||
				fallbackTimezone ||
				BACKUP_DEFAULT_TIMEZONE,
		),
		retentionCount: normalizeRetentionCount(
			retentionSource,
			previousSchedule.retentionCount,
		),
	};

	const destination = normalizeDestination(
		type,
		input.destination,
		!schedule.enabled,
	);

	return {
		id,
		name,
		type,
		includeAttachments:
			typeof input.includeAttachments === "boolean"
				? input.includeAttachments
				: (previous?.includeAttachments ?? false),
		destination,
		schedule,
		runtime,
	};
}

function parseLegacyBackupSettings(
	rawValue: Record<string, unknown>,
	fallbackTimezone: string,
): BackupSettings {
	const legacyFrequency = asTrimmedString(rawValue.frequency).toLowerCase();
	const intervalHours =
		legacyFrequency === "weekly"
			? 24 * 7
			: legacyFrequency === "monthly"
				? 24 * 30
				: BACKUP_DEFAULT_INTERVAL_HOURS;
	const destinationTypeRaw = asTrimmedString(rawValue.destinationType);
	const destinationType: BackupDestinationType =
		destinationTypeRaw === "e3" ||
		destinationTypeRaw === "s3" ||
		destinationTypeRaw === "webdav"
			? getDestinationType(destinationTypeRaw)
			: "webdav";
	const destination = {
		id: createBackupRandomId(),
		name: defaultDestinationName(destinationType, 1),
		type: destinationType,
		includeAttachments: false,
		destination: normalizeDestination(destinationType, rawValue.destination),
		schedule: {
			enabled: !!rawValue.enabled,
			intervalHours,
			startTime: BACKUP_DEFAULT_START_TIME,
			timezone: assertValidTimeZone(
				asTrimmedString(rawValue.timezone) ||
					fallbackTimezone ||
					BACKUP_DEFAULT_TIMEZONE,
			),
			retentionCount: 30,
		},
		runtime: normalizeRuntime(rawValue.runtime),
	} satisfies BackupDestinationRecord;

	return {
		destinations: [destination],
	};
}

function parseDestinations(
	rawDestinations: unknown,
	previousById: Map<string, BackupDestinationRecord>,
	fallbackTimezone: string,
): BackupDestinationRecord[] {
	if (!Array.isArray(rawDestinations)) {
		throw new Error("Backup destinations are invalid");
	}
	if (rawDestinations.length > MAX_BACKUP_DESTINATIONS) {
		throw new Error(
			`You can save up to ${MAX_BACKUP_DESTINATIONS} backup destinations`,
		);
	}

	const destinations = rawDestinations.map((entry, index) =>
		normalizeDestinationRecord(entry, previousById, index, fallbackTimezone),
	);
	const ids = new Set<string>();
	for (const destination of destinations) {
		if (ids.has(destination.id)) {
			throw new Error("Backup destination ids must be unique");
		}
		ids.add(destination.id);
	}
	return destinations;
}

function mapDestinationsById(
	destinations: BackupDestinationRecord[],
): Map<string, BackupDestinationRecord> {
	return new Map(
		destinations.map((destination) => [destination.id, destination]),
	);
}

export function getDefaultBackupSettings(timezone = "UTC"): BackupSettings {
	return createSharedDefaultBackupSettings(assertValidTimeZone(timezone));
}

export function parseBackupSettings(
	raw: string | null,
	fallbackTimezone = "UTC",
): BackupSettings {
	if (!raw) return getDefaultBackupSettings(fallbackTimezone);
	try {
		const parsed = safeParseJsonWithSchema(
			raw,
			v.record(v.string(), v.unknown()),
		);
		if (!parsed) return getDefaultBackupSettings(fallbackTimezone);
		if (Array.isArray(parsed.destinations)) {
			const globalTimezone = assertValidTimeZone(
				asTrimmedString(parsed.timezone) ||
					fallbackTimezone ||
					BACKUP_DEFAULT_TIMEZONE,
			);
			const globalEnabled = !!parsed.enabled;
			const activeDestinationIdRaw = asTrimmedString(
				parsed.activeDestinationId,
			);
			const globalFrequency = asTrimmedString(parsed.frequency).toLowerCase();
			const globalIntervalHours =
				globalFrequency === "weekly"
					? 24 * 7
					: globalFrequency === "monthly"
						? 24 * 30
						: BACKUP_DEFAULT_INTERVAL_HOURS;
			const previousById = new Map<string, BackupDestinationRecord>();
			const normalizedEntries = (parsed.destinations as unknown[]).map(
				(entry) => {
					if (!isPlainObject(entry)) return entry;
					if (isPlainObject(entry.schedule)) return entry;
					const entryId = asTrimmedString(entry.id);
					const scheduleEnabled =
						globalEnabled &&
						(!activeDestinationIdRaw || entryId === activeDestinationIdRaw);
					return {
						...entry,
						schedule: {
							enabled: scheduleEnabled,
							intervalHours: globalIntervalHours,
							startTime: BACKUP_DEFAULT_START_TIME,
							timezone: globalTimezone,
							retentionCount: 30,
						},
					};
				},
			);
			return {
				destinations: parseDestinations(
					normalizedEntries,
					previousById,
					fallbackTimezone,
				),
			};
		}
		return parseLegacyBackupSettings(parsed, fallbackTimezone);
	} catch {
		return getDefaultBackupSettings(fallbackTimezone);
	}
}

export function normalizeBackupSettingsInput(
	input: BackupSettingsInput,
	previous: BackupSettings,
): BackupSettings {
	if (!isPlainObject(input)) {
		throw new Error("Backup settings payload is invalid");
	}

	const previousById = mapDestinationsById(previous.destinations);
	const rawDestinations = input.destinations ?? previous.destinations;
	const destinations = parseDestinations(
		rawDestinations,
		previousById,
		BACKUP_DEFAULT_TIMEZONE,
	);

	return {
		destinations,
	};
}

export function serializeBackupSettings(settings: BackupSettings): string {
	return JSON.stringify(settings);
}

export function findBackupDestination(
	settings: BackupSettings,
	destinationId: string | null | undefined,
): BackupDestinationRecord | null {
	const normalizedId = asTrimmedString(destinationId);
	if (!normalizedId) return null;
	return (
		settings.destinations.find(
			(destination) => destination.id === normalizedId,
		) || null
	);
}

export function requireBackupDestination(
	settings: BackupSettings,
	destinationId?: string | null,
): BackupDestinationRecord {
	const destination = destinationId
		? findBackupDestination(settings, destinationId)
		: settings.destinations[0] || null;
	if (!destination) {
		throw new Error("Backup destination not found");
	}
	return destination;
}
import { safeParseJsonWithSchema } from "@edgewarden/shared";
import * as v from "valibot";
