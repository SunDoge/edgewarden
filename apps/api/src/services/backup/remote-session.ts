import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import { getR2StorageBinding } from "../blob-store";
import { loadBackupSettings, requireBackupDestination } from "./config";
import { createRemoteBackupTransferSession } from "./uploader";

export async function loadRemoteBackupSession(
	db: Kysely<DB>,
	dataEncryptionSecret: string,
	env: CloudflareBindings,
	destinationId?: string | null,
) {
	const settings = await loadBackupSettings(db, dataEncryptionSecret, "UTC");
	const destination = requireBackupDestination(settings, destinationId);
	return {
		destination,
		session: createRemoteBackupTransferSession(destination, {
			r2Bucket: getR2StorageBinding(env),
		}),
	};
}
