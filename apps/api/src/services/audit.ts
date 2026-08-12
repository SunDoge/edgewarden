import type { Kysely } from "kysely";
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

const AUDIT_SETTINGS_KEY = "audit.log.settings.v1";
export interface AuditLogSettings {
	retentionDays: 7 | 30 | 90 | 180 | 365 | null;
	maxEntries: number | null;
}
const DEFAULT_AUDIT_SETTINGS: AuditLogSettings = {
	retentionDays: null,
	maxEntries: null,
};

export async function getAuditLogSettings(
	db: Kysely<DB>,
): Promise<AuditLogSettings> {
	const row = await db
		.selectFrom("config")
		.select("value")
		.where("key", "=", AUDIT_SETTINGS_KEY)
		.executeTakeFirst();
	if (!row) return DEFAULT_AUDIT_SETTINGS;
	try {
		const value = JSON.parse(row.value) as Partial<AuditLogSettings>;
		const retentionDays = [7, 30, 90, 180, 365].includes(
			Number(value.retentionDays),
		)
			? (Number(value.retentionDays) as AuditLogSettings["retentionDays"])
			: null;
		const maxEntries =
			Number.isInteger(value.maxEntries) &&
			Number(value.maxEntries) >= 100 &&
			Number(value.maxEntries) <= 1_000_000
				? Number(value.maxEntries)
				: null;
		return retentionDays
			? { retentionDays, maxEntries: null }
			: { retentionDays: null, maxEntries };
	} catch {
		return DEFAULT_AUDIT_SETTINGS;
	}
}

export async function applyAuditLogRetention(
	db: Kysely<DB>,
	settings: AuditLogSettings,
): Promise<void> {
	if (settings.retentionDays)
		await db
			.deleteFrom("audit_logs")
			.where("created_at", "<", now() - settings.retentionDays * 86_400)
			.execute();
	if (settings.maxEntries) {
		const excess = await db
			.selectFrom("audit_logs")
			.select("id")
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

export async function saveAuditLogSettings(
	db: Kysely<DB>,
	settings: AuditLogSettings,
): Promise<AuditLogSettings> {
	await db
		.insertInto("config")
		.values({ key: AUDIT_SETTINGS_KEY, value: JSON.stringify(settings) })
		.onConflict((oc) =>
			oc.column("key").doUpdateSet({ value: JSON.stringify(settings) }),
		)
		.execute();
	await applyAuditLogRetention(db, settings);
	return settings;
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

function sanitizeMetadata(
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	const clean: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(metadata)) {
		if (!ALLOWED_METADATA_KEYS.has(key)) continue;
		if (value === undefined || value === null || value === "") continue;
		if (/(token|secret|password|key|hash|code|private)/i.test(key)) continue;
		if (Array.isArray(value)) {
			clean[key] = value.length;
			continue;
		}
		if (typeof value === "object") continue;
		clean[key] = value;
	}
	return clean;
}

export async function safeWriteAuditEvent(
	db: Kysely<DB>,
	event: AuditEventInput,
): Promise<void> {
	try {
		const metadata = sanitizeMetadata(event.metadata || {});
		const metadataJson = JSON.stringify(metadata);

		await db
			.insertInto("audit_logs")
			.values({
				id: crypto.randomUUID(),
				actor_user_id: event.actorUserId ?? null,
				action: event.action,
				category: event.category,
				level: event.level || "info",
				target_type: event.targetType ?? null,
				target_id: event.targetId ?? null,
				metadata: metadataJson,
				created_at: now(),
			})
			.execute();
		await applyAuditLogRetention(db, await getAuditLogSettings(db));
	} catch (error) {
		console.error("Failed to write audit log:", error);
	}
}
