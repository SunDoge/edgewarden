import { now } from "../../utils/time";

export async function publishSendFileObject(
	db: D1Database,
	args: {
		sendId: string;
		userId: string;
		fileId: string;
		storageKey: string;
		expectedStorageKey: string | null;
	},
	timestamp = now(),
): Promise<"published" | "conflict" | "missing"> {
	const results = await db.batch([
		db
			.prepare(`
				UPDATE sends SET storage_key = ?, updated_at = ?
				WHERE id = ? AND user_id = ? AND type = 1
				  AND json_valid(data)
				  AND json_extract(data, '$.id') = ?
				  AND deletion_date > ?
				  AND purge_token IS NULL
				  AND storage_key IS ?
			`)
			.bind(
				args.storageKey,
				timestamp,
				args.sendId,
				args.userId,
				args.fileId,
				timestamp,
				args.expectedStorageKey,
			),
		db
			.prepare(`
				INSERT OR IGNORE INTO blob_gc_queue (
					object_key, attempts, next_attempt_at, last_error, created_at
				)
				SELECT ?, 0, ?, NULL, ? FROM sends
				WHERE id = ? AND storage_key = ? AND ? IS NOT NULL
			`)
			.bind(
				args.expectedStorageKey,
				timestamp,
				timestamp,
				args.sendId,
				args.storageKey,
				args.expectedStorageKey,
			),
		db
			.prepare(`
				INSERT INTO user_revisions (user_id, revision_date)
				SELECT user_id, ? FROM sends
				WHERE id = ? AND storage_key = ? AND purge_token IS NULL
				ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
					user_revisions.revision_date + 1,
					excluded.revision_date
				)
			`)
			.bind(timestamp, args.sendId, args.storageKey),
	]);
	if (Number(results[0]?.meta?.changes ?? 0) === 1) return "published";
	const stillUploadable = await db
		.prepare(`
			SELECT 1 FROM sends
			WHERE id = ? AND user_id = ? AND type = 1
			  AND json_valid(data)
			  AND json_extract(data, '$.id') = ?
			  AND deletion_date > ?
			  AND purge_token IS NULL
		`)
		.bind(args.sendId, args.userId, args.fileId, timestamp)
		.first();
	return stillUploadable ? "conflict" : "missing";
}
