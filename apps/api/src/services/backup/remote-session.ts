import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import { loadBackupSettings, requireBackupDestination } from "./config";
import { createRemoteBackupTransferSession } from "./uploader";

export async function loadRemoteBackupSession(
	db: Kysely<DB>,
	dataEncryptionSecret: string,
	destinationId?: string | null,
) {
	const settings = await loadBackupSettings(db, dataEncryptionSecret, "UTC");
	const destination = requireBackupDestination(settings, destinationId);
	return {
		destination,
		session: createRemoteBackupTransferSession(destination),
	};
}
