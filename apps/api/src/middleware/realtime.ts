import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env";
import { publishMutationVaultChange } from "../services/realtime";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const realtimeMutationMiddleware = createMiddleware<HonoEnv>(
	async (c, next) => {
		await next();
		if (
			!MUTATING_METHODS.has(c.req.method) ||
			c.req.path === "/api/notifications/token" ||
			c.res.status < 200 ||
			c.res.status >= 300
		)
			return;
		const userId = c.get("user").id;
		const organizationId =
			c.get("cipher")?.org_id ?? c.req.param("orgId") ?? null;
		c.executionCtx.waitUntil(
			publishMutationVaultChange(c.env, userId, organizationId).catch(
				(error) => {
					console.error(
						JSON.stringify({
							event: "realtime.publish.failed",
							path: c.req.path,
							error: error instanceof Error ? error.message : String(error),
						}),
					);
				},
			),
		);
	},
);
