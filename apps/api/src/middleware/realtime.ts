import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env";
import { publishVaultChange, realtimeAudience } from "../services/realtime";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const realtimeMutationMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
	await next();
	if (
		!(c.env as any).REALTIME ||
		!MUTATING_METHODS.has(c.req.method) ||
		c.req.path === "/api/notifications/token" ||
		c.res.status < 200 ||
		c.res.status >= 300
	) return;
	const audience = await realtimeAudience(c);
	c.executionCtx.waitUntil(publishVaultChange(c.env, audience));
});
