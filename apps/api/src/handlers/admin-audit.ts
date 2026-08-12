import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import { AuditLogQuerySchema, AuditLogSettingsSchema } from "../schemas/admin";
import {
	auditRequestMetadata,
	getAuditLogSettings,
	safeWriteAuditEvent,
	saveAuditLogSettings,
} from "../services/audit";
import { toIso } from "../utils/time";

export const listAuditLogs = factory.createHandlers(
	vValidator("query", AuditLogQuerySchema),
	async (c) => {
		const query = c.req.valid("query");
		const limit = query.limit ?? 50;
		const offset = query.offset ?? 0;
		let rows = c
			.get("db")
			.selectFrom("audit_logs as log")
			.leftJoin("users as actor", "actor.id", "log.actor_user_id")
			.select([
				"log.id",
				"log.actor_user_id",
				"actor.email as actor_email",
				"log.action",
				"log.category",
				"log.level",
				"log.target_type",
				"log.target_id",
				"log.metadata",
				"log.created_at",
			]);
		if (query.category) rows = rows.where("log.category", "=", query.category);
		if (query.level) rows = rows.where("log.level", "=", query.level);
		if (query.q)
			rows = rows.where((eb) =>
				eb.or([
					eb("log.action", "like", `%${query.q}%`),
					eb("log.metadata", "like", `%${query.q}%`),
					eb("actor.email", "like", `%${query.q}%`),
				]),
			);
		const data = await rows
			.orderBy("log.created_at", "desc")
			.limit(limit)
			.offset(offset)
			.execute();
		let count = c
			.get("db")
			.selectFrom("audit_logs")
			.select((eb) => eb.fn.countAll<number>().as("total"));
		if (query.category) count = count.where("category", "=", query.category);
		if (query.level) count = count.where("level", "=", query.level);
		if (query.q)
			count = count.where((eb) =>
				eb.or([
					eb("action", "like", `%${query.q}%`),
					eb("metadata", "like", `%${query.q}%`),
				]),
			);
		const total = Number((await count.executeTakeFirst())?.total ?? 0);
		return c.json({
			data: data.map((log) => ({
				id: log.id,
				actorUserId: log.actor_user_id,
				actorEmail: log.actor_email,
				action: log.action,
				category: log.category,
				level: log.level,
				targetType: log.target_type,
				targetId: log.target_id,
				metadata: log.metadata ? JSON.parse(log.metadata) : {},
				createdAt: toIso(log.created_at),
				object: "auditLog",
			})),
			total,
			limit,
			offset,
			hasMore: offset + data.length < total,
			object: "list",
		});
	},
);

export const getAuditSettings = factory.createHandlers(async (c) =>
	c.json({
		...(await getAuditLogSettings(c.get("db"))),
		object: "auditLogSettings",
	}),
);

export const updateAuditSettings = factory.createHandlers(
	vValidator("json", AuditLogSettingsSchema),
	async (c) => {
		const body = c.req.valid("json");
		const settings = await saveAuditLogSettings(c.get("db"), {
			retentionDays: body.retentionDays ?? null,
			maxEntries: body.maxEntries ?? null,
		});
		await safeWriteAuditEvent(c.get("db"), {
			actorUserId: c.get("user").id,
			action: "admin.audit.settings",
			category: "admin",
			metadata: auditRequestMetadata(c.req.raw),
		});
		return c.json({ ...settings, object: "auditLogSettings" });
	},
);
