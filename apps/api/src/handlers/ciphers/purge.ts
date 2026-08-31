import { vValidator } from "@hono/valibot-validator";
import { sql } from "kysely";
import { factory } from "../../http/factory";
import {
  CipherPurgeQuerySchema,
  CipherPurgeSchema,
} from "../../schemas/ciphers";
import {
  auditEventInsertQuery,
  auditRequestMetadata,
} from "../../services/audit";
import { verifyPassword } from "../../services/auth";
import {
  organizationRevisionQuery,
  revisionQuery,
} from "../../services/db/batch";
import { errorResponse } from "../../utils/response";
import { now } from "../../utils/time";

export const purgeCiphers = factory.createHandlers(
  vValidator("query", CipherPurgeQuerySchema),
  vValidator("json", CipherPurgeSchema),
  async (c, next) => {
    const user = c.get("user");
    if (
      !(await verifyPassword(
        c.req.valid("json").secret,
        user.master_password_hash,
        user.email,
      ))
    )
      return errorResponse("User verification failed", 400);
    const { organizationId } = c.req.valid("query");
    if (organizationId) {
      const member = await c
        .get("db")
        .selectFrom("org_members")
        .select(["role", "access_all"])
        .where("org_id", "=", organizationId)
        .where("user_id", "=", user.id)
        .where("status", "=", "confirmed")
        .executeTakeFirst();
      if (
        !member ||
        (!member.access_all &&
          !["manager", "admin", "owner"].includes(member.role))
      )
        return errorResponse("Organization not found", 404);
    }
    await next();
  },
  async (c) => {
    const user = c.get("user");
    const { organizationId } = c.req.valid("query");
    const db = c.get("db");

    const timestamp = now();
    const mutationToken = crypto.randomUUID();
    // Sync hides tombstoned items immediately. Scheduled maintenance performs
    // physical row and attachment deletion through the existing purge flow.
    const purgeBaseQuery = db.updateTable("ciphers").set({
      deleted_at: timestamp,
      purge_after: timestamp,
      updated_at: sql<number>`MAX(updated_at + 1, ${timestamp})`,
      mutation_token: mutationToken,
    });
    const purgeQuery = organizationId
      ? purgeBaseQuery.where("org_id", "=", organizationId)
      : purgeBaseQuery.where("user_id", "=", user.id);
    await c.get("dbDialect").batch([
      purgeQuery,
      organizationId
        ? organizationRevisionQuery(db, organizationId, timestamp)
        : revisionQuery(db, user.id, timestamp),
      auditEventInsertQuery(
        db,
        {
          actorUserId: user.id,
          action: organizationId
            ? "cipher.purge.organization"
            : "cipher.purge.personal",
          category: "vault",
          level: "warning",
          targetType: organizationId ? "organization" : "user",
          targetId: organizationId ?? user.id,
          metadata: auditRequestMetadata(c.req.raw),
        },
        sql<boolean>`EXISTS (
          SELECT 1 FROM ciphers WHERE mutation_token = ${mutationToken}
        )`,
        timestamp,
      ),
    ]);
    return new Response(null, { status: 200 });
  },
);
