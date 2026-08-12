import { now } from "../../utils/time";

export async function publishSendFileObject(
	db: D1Database,
	args: {
		sendId: string;
		userId: string;
		fileId: string;
		storageKey: string;
	},
	timestamp = now(),
): Promise<boolean> {
	const results = await db.batch([
		db
			.prepare(`
				INSERT OR IGNORE INTO blob_gc_queue (
					object_key, attempts, next_attempt_at, last_error, created_at
				)
				SELECT storage_key, 0, ?, NULL, ? FROM sends
				WHERE id = ? AND storage_key IS NOT NULL AND storage_key <> ?
			`)
			.bind(timestamp, timestamp, args.sendId, args.storageKey),
		db
			.prepare(`
				UPDATE sends SET storage_key = ?, updated_at = ?
				WHERE id = ? AND user_id = ? AND type = 1
				  AND json_valid(data)
				  AND json_extract(data, '$.id') = ?
				  AND deletion_date > ?
			`)
			.bind(
				args.storageKey,
				timestamp,
				args.sendId,
				args.userId,
				args.fileId,
				timestamp,
			),
		db
			.prepare(`
				INSERT INTO user_revisions (user_id, revision_date)
				SELECT user_id, ? FROM sends WHERE id = ? AND storage_key = ?
				ON CONFLICT(user_id) DO UPDATE SET revision_date = MAX(
					user_revisions.revision_date + 1,
					excluded.revision_date
				)
			`)
			.bind(timestamp, args.sendId, args.storageKey),
	]);
	return Number(results[1]?.meta?.changes ?? 0) === 1;
}
