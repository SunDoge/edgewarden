import { type Kysely, sql } from "kysely";
import type { DB } from "../types/db";
import { now } from "../utils/time";
import type { BlobStore } from "./blob-store";
import { deleteBlobObject } from "./blob-store";

const BATCH_LIMIT = 100;
const CLAIM_SECONDS = 15 * 60;

export interface BlobGcResult {
	deleted: number;
	referenced: number;
	deferred: number;
	contended: number;
}

export async function enqueueBlobGcKeys(
	db: D1Database,
	keys: Iterable<string>,
	timestamp = now(),
): Promise<void> {
	const uniqueKeys = [...new Set(keys)].filter(Boolean);
	if (!uniqueKeys.length) return;
	await db.batch(
		uniqueKeys.map((key) =>
			db
				.prepare(
					"INSERT OR IGNORE INTO blob_gc_queue (object_key, attempts, next_attempt_at, last_error, created_at) VALUES (?, 0, ?, NULL, ?)",
				)
				.bind(key, timestamp, timestamp),
		),
	);
}

export async function discardUnpublishedBlob(
	env: CloudflareBindings,
	objectKey: string,
): Promise<void> {
	try {
		await enqueueBlobGcKeys(env.DB, [objectKey]);
	} catch (enqueueError) {
		try {
			await deleteBlobObject(env, objectKey);
		} catch (deleteError) {
			throw new AggregateError(
				[enqueueError, deleteError],
				`Unable to schedule or delete unpublished blob: ${objectKey}`,
			);
		}
	}
}

async function isReferenced(
	db: Kysely<DB>,
	objectKey: string,
): Promise<boolean> {
	const result = await sql<{ referenced: number }>`
		select exists(
			select 1 from attachments
			where coalesce(storage_key, 'attachments/' || cipher_id || '/' || id || '.bin') = ${objectKey}
			union all
			select 1 from sends
			where type = 1
				and json_valid(data)
				and json_type(data, '$.id') = 'text'
				and coalesce(
					storage_key,
					'sends/' || id || '/' || json_extract(data, '$.id')
				) = ${objectKey}
		) as referenced
	`.execute(db);
	return Number(result.rows[0]?.referenced ?? 0) === 1;
}

function retryAt(timestamp: number, attempts: number): number {
	return timestamp + Math.min(86_400, 60 * 2 ** Math.min(attempts, 10));
}

export async function drainBlobGcQueue(
	db: Kysely<DB>,
	blobStore: BlobStore,
	timestamp = now(),
): Promise<BlobGcResult> {
	const rows = await db
		.selectFrom("blob_gc_queue")
		.selectAll()
		.where("next_attempt_at", "<=", timestamp)
		.orderBy("next_attempt_at", "asc")
		.orderBy("created_at", "asc")
		.limit(BATCH_LIMIT)
		.execute();
	const result: BlobGcResult = {
		deleted: 0,
		referenced: 0,
		deferred: 0,
		contended: 0,
	};

	for (const row of rows) {
		const claimUntil = timestamp + CLAIM_SECONDS;
		const claim = await db
			.updateTable("blob_gc_queue")
			.set({ next_attempt_at: claimUntil })
			.where("object_key", "=", row.object_key)
			.where("attempts", "=", row.attempts)
			.where("next_attempt_at", "=", row.next_attempt_at)
			.executeTakeFirst();
		if (Number(claim.numUpdatedRows) !== 1) {
			result.contended += 1;
			continue;
		}

		if (await isReferenced(db, row.object_key)) {
			const removed = await db
				.deleteFrom("blob_gc_queue")
				.where("object_key", "=", row.object_key)
				.where("attempts", "=", row.attempts)
				.where("next_attempt_at", "=", claimUntil)
				.executeTakeFirst();
			if (Number(removed.numDeletedRows) === 1) result.referenced += 1;
			else result.contended += 1;
			continue;
		}
		try {
			await blobStore.delete(row.object_key);
			const removed = await db
				.deleteFrom("blob_gc_queue")
				.where("object_key", "=", row.object_key)
				.where("attempts", "=", row.attempts)
				.where("next_attempt_at", "=", claimUntil)
				.executeTakeFirst();
			if (Number(removed.numDeletedRows) === 1) result.deleted += 1;
			else result.contended += 1;
		} catch (error) {
			const attempts = row.attempts + 1;
			const deferred = await db
				.updateTable("blob_gc_queue")
				.set({
					attempts,
					next_attempt_at: retryAt(timestamp, attempts),
					last_error: (error instanceof Error
						? error.message
						: String(error)
					).slice(0, 500),
				})
				.where("object_key", "=", row.object_key)
				.where("attempts", "=", row.attempts)
				.where("next_attempt_at", "=", claimUntil)
				.executeTakeFirst();
			if (Number(deferred.numUpdatedRows) === 1) result.deferred += 1;
			else result.contended += 1;
		}
	}
	return result;
}
