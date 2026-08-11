import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { LIMITS } from "./config";
import type { HonoEnv } from "./env";
import { dbMiddleware } from "./middleware/db";
import { publicRouter } from "./routes/public";
import { vaultRouter } from "./routes/vault";

const baseApp = new Hono<HonoEnv>();

// Validate JWT secret is configured
baseApp.use("*", async (c, next) => {
	if (
		!c.env.JWT_SECRET ||
		c.env.JWT_SECRET.length < LIMITS.auth.jwtSecretMinLength
	) {
		return c.json(
			{
				message:
					"JWT_SECRET must be at least 32 characters. Set it in .dev.vars or as a Worker secret.",
				object: "error",
			},
			500,
		);
	}
	await next();
});

// CORS — echo back all origins so browser extensions work
baseApp.use(
	"*",
	cors({
		origin: (origin) => origin,
		credentials: true,
		allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowHeaders: [
			"Authorization",
			"Content-Type",
			"X-Requested-With",
			"Device-Type",
		],
		maxAge: LIMITS.cors.preflightMaxAgeSeconds,
	}),
);

// Security headers
baseApp.use(
	"*",
	secureHeaders({
		xFrameOptions: "DENY",
		xContentTypeOptions: "nosniff",
		referrerPolicy: "no-referrer",
	}),
);

baseApp.use("*", dbMiddleware);

export const app = baseApp.route("/", publicRouter).route("/", vaultRouter);
export type AppType = typeof app;

// 404 fallback
app.notFound((c) => c.json({ message: "Not found", object: "error" }, 404));

import { runScheduledBackupIfDue } from "./services/backup/scheduler";
export { VaultRealtime } from "./durable-objects/vault-realtime";

export default {
	fetch: app.fetch,
	async scheduled(
		_controller: ScheduledController,
		env: CloudflareBindings,
		ctx: ExecutionContext,
	) {
		ctx.waitUntil(runScheduledBackupIfDue(env.DB, env.JWT_SECRET));
	},
};
