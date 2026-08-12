import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { LIMITS } from "./config";
import type { HonoEnv } from "./env";
import { dbMiddleware } from "./middleware/db";
import { publicRouter } from "./routes/public";
import { vaultRouter } from "./routes/vault";

const baseApp = new Hono<HonoEnv>();

// Bound request buffering before validators or handlers parse attacker-controlled
// bodies. File endpoints retain their documented 100 MiB allowance.
baseApp.use("*", async (c, next) => {
	const contentType = c.req.header("content-type")?.toLowerCase() ?? "";
	const maxSize = contentType.includes("application/json")
		? LIMITS.requestBody.jsonBytes
		: contentType.includes("application/x-www-form-urlencoded")
			? LIMITS.requestBody.formBytes
			: LIMITS.requestBody.blobBytes;
	return bodyLimit({
		maxSize,
		onError: (context) =>
			context.json(
				{ message: "Request body is too large", object: "error" },
				413,
			),
	})(c, next);
});

// Validate independent token-signing and persisted-data encryption secrets.
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
	if (
		!c.env.DATA_ENCRYPTION_SECRET ||
		c.env.DATA_ENCRYPTION_SECRET.length < LIMITS.auth.jwtSecretMinLength
	) {
		return c.json(
			{
				message:
					"DATA_ENCRYPTION_SECRET must be at least 32 characters. Set it in .dev.vars or as a Worker secret.",
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
		origin: (origin, c) => {
			const sameOrigin = origin === new URL(c.req.url).origin;
			const extensionOrigin =
				/^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(
					origin,
				);
			const configured = String(
				(c.env as CloudflareBindings & { CORS_ALLOWED_ORIGINS?: string })
					.CORS_ALLOWED_ORIGINS ?? "",
			)
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean);
			return sameOrigin || extensionOrigin || configured.includes(origin)
				? origin
				: "";
		},
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
		contentSecurityPolicy: {
			defaultSrc: ["'self'"],
			baseUri: ["'none'"],
			connectSrc: [
				"'self'",
				"wss:",
				"https://challenges.cloudflare.com",
				"https://api.pwnedpasswords.com",
			],
			fontSrc: ["'self'"],
			formAction: ["'self'"],
			frameAncestors: ["'none'"],
			frameSrc: ["https://challenges.cloudflare.com"],
			imgSrc: ["'self'", "data:", "blob:"],
			manifestSrc: ["'self'"],
			objectSrc: ["'none'"],
			scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
			scriptSrcAttr: ["'none'"],
			styleSrc: ["'self'", "'unsafe-inline'"],
			workerSrc: ["'self'", "blob:"],
		},
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

app.onError((error, c) => {
	console.error(
		JSON.stringify({
			event: "request.error",
			requestId: c.req.header("cf-ray") ?? crypto.randomUUID(),
			method: c.req.method,
			path: c.req.path,
			errorName: error.name,
			errorMessage: error.message,
			cause:
				error.cause instanceof Error
					? { name: error.cause.name, message: error.cause.message }
					: undefined,
		}),
	);
	return c.json({ message: "Internal server error", object: "error" }, 500);
});

import { runScheduledBackupIfDue } from "./services/backup/scheduler";
import { runScheduledMaintenance } from "./services/maintenance";

export { VaultRealtime } from "./durable-objects/vault-realtime";

export default {
	fetch: app.fetch,
	async scheduled(
		_controller: ScheduledController,
		env: CloudflareBindings,
		ctx: ExecutionContext,
	) {
		ctx.waitUntil(
			(async () => {
				// Keep backup snapshots consistent with scheduled deletion and avoid
				// overlapping independent D1 sessions on the same database binding.
				await runScheduledBackupIfDue(env);
				await runScheduledMaintenance(env);
			})(),
		);
	},
};
