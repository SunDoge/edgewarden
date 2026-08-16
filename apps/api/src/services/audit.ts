import { safeParseJsonWithSchema } from "@edgewarden/shared";
import { type CompiledQuery, type Kysely, type RawBuilder, sql } from "kysely";
import * as v from "valibot";
import type { DB } from "../types/db";
import { now } from "../utils/time";
import { textColumnInJson } from "./db/json-array";

export type AuditLogCategory = "auth" | "vault" | "admin" | "system" | "org";
export type AuditLogLevel = "info" | "warning" | "error";

export interface AuditEventInput {
	actorUserId?: string | null;
	action: string;
	category: AuditLogCategory;
	level?: AuditLogLevel;
	targetType?: string | null;
	targetId?: string | null;
	metadata?: Record<string, unknown> | null;
}

const ALLOWED_METADATA_KEYS = new Set([
	"method",
	"path",
	"ip",
	"userAgent",
	"email",
	"targetEmail",
	"grantType",
	"webSession",
	"deviceIdentifier",
	"deviceType",
	"reason",
	"status",
	"type",
	"folderId",
	"cipherId",
	"size",
	"prfStatus",
	"fileName",
	"error",
	"signupsAllowed",
	"invitationsAllowed",
]);

export const MAX_AUDIT_METADATA_BYTES = 4 * 1024;
export const MAX_AUDIT_METADATA_STRING_BYTES = 1024;
const utf8 = new TextEncoder();

export const AUDIT_SETTINGS_KEY = "audit.log.settings.v1";
export interface AuditLogSettings {
	retentionDays: 7 | 30 | 90 | 180 | 365 | null;
	maxEntries: number | null;
}
const DEFAULT_AUDIT_SETTINGS: AuditLogSettings = {
	retentionDays: null,
	maxEntries: null,
};
const AuditLogSettingsStorageSchema = v.partial(
	v.object({
		retentionDays: v.nullable(v.picklist([7, 30, 90, 180, 365])),
		maxEntries: v.nullable(
			v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(1_000_000)),
		),
	}),
);

export function isAuditTombstoneAction(action: string): boolean {
	return (
		action.endsWith(".delete") ||
		action.includes(".delete.") ||
		action.endsWith(".purged")
	);
}

export async function getAuditLogSettings(
	db: Kysely<DB>,
): Promise<AuditLogSettings> {
	const row = await db
		.selectFrom("config")
		.select("value")
		.where("key", "=", AUDIT_SETTINGS_KEY)
		.executeTakeFirst();
	if (!row) return DEFAULT_AUDIT_SETTINGS;
	const value = safeParseJsonWithSchema(
		row.value,
		AuditLogSettingsStorageSchema,
	);
	if (!value) return DEFAULT_AUDIT_SETTINGS;
	const retentionDays = value.retentionDays ?? null;
	const maxEntries = value.maxEntries ?? null;
	return retentionDays
		? { retentionDays, maxEntries: null }
		: { retentionDays: null, maxEntries };
}

export async function applyAuditLogRetention(
	db: Kysely<DB>,
	settings: AuditLogSettings,
): Promise<void> {
	if (settings.retentionDays)
		await db
			.deleteFrom("audit_logs")
			.where("created_at", "<", now() - settings.retentionDays * 86_400)
			.where("is_tombstone", "=", 0)
			.execute();
	if (settings.maxEntries) {
		const excess = await db
			.selectFrom("audit_logs")
			.select("id")
			.where("is_tombstone", "=", 0)
			.orderBy("created_at", "desc")
			.limit(1_000_000)
			.offset(settings.maxEntries)
			.execute();
		if (excess.length)
			await db
				.deleteFrom("audit_logs")
				.where(
					textColumnInJson(
						"id",
						excess.map((row) => row.id),
					),
				)
				.execute();
	}
}

export function auditLogSettingsQuery(
	db: Kysely<DB>,
	settings: AuditLogSettings,
): CompiledQuery {
	const value = JSON.stringify(settings);
	return db
		.insertInto("config")
		.values({ key: AUDIT_SETTINGS_KEY, value })
		.onConflict((oc) => oc.column("key").doUpdateSet({ value }))
		.compile();
}

export function auditRequestMetadata(
	request: Request,
): Record<string, unknown> {
	const url = new URL(request.url);
	return {
		method: request.method,
		path: url.pathname,
		ip:
			request.headers.get("CF-Connecting-IP") ||
			request.headers.get("X-Forwarded-For") ||
			null,
		userAgent: request.headers.get("User-Agent") || null,
	};
}

function truncateUtf8(value: string, maximumBytes: number): string {
	if (utf8.encode(value).byteLength <= maximumBytes) return value;
	const characters: string[] = [];
	let bytes = 0;
	for (const character of value) {
		const characterBytes = utf8.encode(character).byteLength;
		if (bytes + characterBytes > maximumBytes) break;
		characters.push(character);
		bytes += characterBytes;
	}
	return characters.join("");
}

export function serializeAuditMetadata(
	metadata: Record<string, unknown>,
): string {
	const clean: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(metadata)) {
		if (!ALLOWED_METADATA_KEYS.has(key)) continue;
		if (value === undefined || value === null || value === "") continue;
		if (/(token|secret|password|key|hash|code|private)/i.test(key)) continue;
		let cleanValue: string | number | boolean;
		if (Array.isArray(value)) {
			cleanValue = value.length;
		} else if (typeof value === "string") {
			cleanValue = truncateUtf8(value, MAX_AUDIT_METADATA_STRING_BYTES);
		} else if (typeof value === "number") {
			if (!Number.isFinite(value)) continue;
			cleanValue = value;
		} else if (typeof value === "boolean") {
			cleanValue = value;
		} else {
			continue;
		}
		clean[key] = cleanValue;
		if (
			utf8.encode(JSON.stringify(clean)).byteLength > MAX_AUDIT_METADATA_BYTES
		)
			delete clean[key];
	}
	return JSON.stringify(clean);
}

/**
 * Builds an audit insert that can participate in the same D1 batch as the
 * mutation it describes. The optional condition must identify that batch as
 * eligible: inspect the old state when this query precedes the mutation, or a
 * fresh mutation token when it follows it. This prevents racing/idempotent
 * requests from creating false audit tombstones.
 */
export function auditEventInsertQuery(
	db: Kysely<DB>,
	event: AuditEventInput,
	condition: RawBuilder<boolean> = sql<boolean>`TRUE`,
	createdAt = now(),
): CompiledQuery {
	const metadata = serializeAuditMetadata(event.metadata || {});
	return sql`
		INSERT INTO audit_logs (
			id, actor_user_id, action, category, level,
			target_type, target_id, metadata, is_tombstone, created_at
		)
		SELECT
			${crypto.randomUUID()}, ${event.actorUserId ?? null}, ${event.action},
			${event.category}, ${event.level || "info"}, ${event.targetType ?? null},
			${event.targetId ?? null}, ${metadata},
			${isAuditTombstoneAction(event.action) ? 1 : 0}, ${createdAt}
		WHERE ${condition}
	`.compile(db);
}

export async function safeWriteAuditEvent(
	db: Kysely<DB>,
	event: AuditEventInput,
): Promise<void> {
	try {
		await db.executeQuery(auditEventInsertQuery(db, event));
		await applyAuditLogRetention(db, await getAuditLogSettings(db));
	} catch (error) {
		console.error("Failed to write audit log:", error);
	}
}
