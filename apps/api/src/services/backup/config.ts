import type { BackupSettings } from "@edgewarden/shared";
import type { Kysely, Selectable } from "kysely";
import type { DB, Users } from "../../types/db";
import { getConfigValue, setConfigValue } from "../db/config";
import { getAllUsersForBackup } from "../db/users";
import {
	type BackupSettingsPortableEnvelope,
	decryptBackupSettingsRuntime,
	encryptBackupSettingsEnvelope,
	parseBackupSettingsEnvelope,
} from "./settings-crypto";
import {
	findBackupDestination,
	getDefaultBackupSettings,
	normalizeBackupSettingsInput,
	parseBackupSettings,
	requireBackupDestination,
	serializeBackupSettings,
} from "./settings-normalize";

export const BACKUP_SETTINGS_CONFIG_KEY = "backup.settings.v1";

export type {
	BackupDestinationConfig,
	BackupDestinationRecord,
	BackupDestinationType,
	BackupRuntimeState,
	BackupScheduleConfig,
	BackupSettings,
	S3BackupAddressingStyle,
	S3BackupDestination,
	WebDavBackupDestination,
} from "@edgewarden/shared";
export {
	BACKUP_SCHEDULER_WINDOW_MINUTES,
	getBackupLocalDateKey,
	getBackupLocalTime,
	hasBackupSlotBetween,
	isBackupDueNow,
} from "./schedule";
export type { BackupSettingsInput } from "./settings-normalize";
export {
	findBackupDestination,
	getDefaultBackupSettings,
	normalizeBackupSettingsInput,
	parseBackupSettings,
	requireBackupDestination,
	serializeBackupSettings,
};

export interface BackupSettingsRepairState {
	needsRepair: boolean;
	portable: BackupSettingsPortableEnvelope | null;
}

export async function loadBackupSettings(
	db: Kysely<DB>,
	dataEncryptionSecret: string,
	fallbackTimezone = "UTC",
): Promise<BackupSettings> {
	const raw = await getConfigValue(db, BACKUP_SETTINGS_CONFIG_KEY);
	if (!raw) {
		const settings = getDefaultBackupSettings(fallbackTimezone);
		await saveBackupSettings(db, dataEncryptionSecret, settings);
		return settings;
	}

	const envelope = parseBackupSettingsEnvelope(raw);
	if (!envelope) {
		const settings = parseBackupSettings(raw, fallbackTimezone);
		await saveBackupSettings(db, dataEncryptionSecret, settings);
		return settings;
	}

	try {
		const decrypted = await decryptBackupSettingsRuntime(
			raw,
			dataEncryptionSecret,
		);
		return parseBackupSettings(decrypted, fallbackTimezone);
	} catch {
		throw new Error(
			"Backup settings need administrator reactivation after restore",
		);
	}
}

export async function saveBackupSettings(
	db: Kysely<DB>,
	dataEncryptionSecret: string,
	settings: BackupSettings,
): Promise<void> {
	const users = await getAllUsersForBackup(db);
	const encrypted = await encryptBackupSettingsEnvelope(
		serializeBackupSettings(settings),
		dataEncryptionSecret,
		users,
	);
	await setConfigValue(db, BACKUP_SETTINGS_CONFIG_KEY, encrypted);
}

export async function normalizeImportedBackupSettingsValue(
	raw: string | null,
	dataEncryptionSecret: string,
	users: Pick<Selectable<Users>, "id" | "public_key" | "role" | "status">[],
	fallbackTimezone = "UTC",
): Promise<string | null> {
	if (!raw) return null;
	const envelope = parseBackupSettingsEnvelope(raw);
	if (envelope) {
		try {
			const decrypted = await decryptBackupSettingsRuntime(
				raw,
				dataEncryptionSecret,
			);
			const settings = parseBackupSettings(decrypted, fallbackTimezone);
			return encryptBackupSettingsEnvelope(
				serializeBackupSettings(settings),
				dataEncryptionSecret,
				users,
			);
		} catch {
			// Keep imported portable recovery data intact until an admin signs in and repairs it.
			return raw;
		}
	}
	const settings = parseBackupSettings(raw, fallbackTimezone);
	return encryptBackupSettingsEnvelope(
		serializeBackupSettings(settings),
		dataEncryptionSecret,
		users,
	);
}

export async function getBackupSettingsRepairState(
	db: Kysely<DB>,
	dataEncryptionSecret: string,
	fallbackTimezone = "UTC",
): Promise<BackupSettingsRepairState> {
	const raw = await getConfigValue(db, BACKUP_SETTINGS_CONFIG_KEY);
	if (!raw) {
		const settings = getDefaultBackupSettings(fallbackTimezone);
		await saveBackupSettings(db, dataEncryptionSecret, settings);
		return { needsRepair: false, portable: null };
	}

	const envelope = parseBackupSettingsEnvelope(raw);
	if (!envelope) {
		const settings = parseBackupSettings(raw, fallbackTimezone);
		await saveBackupSettings(db, dataEncryptionSecret, settings);
		return { needsRepair: false, portable: null };
	}

	try {
		await decryptBackupSettingsRuntime(raw, dataEncryptionSecret);
		return { needsRepair: false, portable: null };
	} catch {
		return {
			needsRepair: true,
			portable: envelope.portable,
		};
	}
}

export async function repairBackupSettings(
	db: Kysely<DB>,
	dataEncryptionSecret: string,
	settings: BackupSettings,
): Promise<void> {
	await saveBackupSettings(db, dataEncryptionSecret, settings);
}
