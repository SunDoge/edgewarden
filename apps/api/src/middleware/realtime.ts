import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env";
import {
	logPushRelayFailure,
	publishPushVaultChange,
} from "../services/push-relay";
import { publishMutationVaultChange } from "../services/realtime";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const realtimeMutationMiddleware = createMiddleware<HonoEnv>(
	async (c, next) => {
		await next();
		if (
			!MUTATING_METHODS.has(c.req.method) ||
			c.req.path === "/api/notifications/token" ||
			/^\/api\/devices\/identifier\/[^/]+\/(?:token|clear-token)$/.test(
				c.req.path,
			) ||
			c.res.status < 200 ||
			c.res.status >= 300
		)
			return;
		const userId = c.get("user").id;
		const organizationId =
			c.get("cipher")?.org_id ?? c.req.param("orgId") ?? null;
		const revisionDate = Math.floor(Date.now() / 1000);
		c.executionCtx.waitUntil(
			Promise.all([
				publishMutationVaultChange(c.env, userId, organizationId).catch(
					(error) => logPushRelayFailure("realtime.publish.failed", error),
				),
				publishPushVaultChange(
					c.env,
					userId,
					organizationId,
					c.req.header("X-Device-Identifier") ?? null,
					revisionDate,
				).catch((error) => logPushRelayFailure("push.publish.failed", error)),
			]),
		);
	},
);
