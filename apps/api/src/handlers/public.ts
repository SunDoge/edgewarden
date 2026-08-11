import { vValidator } from "@hono/valibot-validator";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { RegisterSchema } from "../schemas/accounts";
import { hashPasswordServer } from "../services/auth";
import { executeBatch, revisionQuery } from "../services/db/batch";
import * as usersDb from "../services/db/users";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";
import { turnstileEnabled, turnstileSiteKey } from "../services/turnstile";

export const registerAccount = factory.createHandlers(
	vValidator("json", RegisterSchema),
	async (c) => {
		const body = c.req.valid("json");
		const db = c.get("db");
		const email = body.email.toLowerCase();

		if (await usersDb.getUserByEmail(db, email)) {
			return errorResponse("Email already taken.", 400);
		}
		const inviteCode = body.inviteCode?.trim();
		const invite = inviteCode
			? await db.selectFrom("invites").selectAll().where("code", "=", inviteCode).where("status", "=", "active").where("expires_at", ">", now()).executeTakeFirst()
			: null;
		if (inviteCode && !invite) return errorResponse("Invite is invalid or expired", 400);
		if (body.kdf === 0 && body.kdfIterations < 100_000) {
			return errorResponse("PBKDF2 iterations must be at least 100000", 400);
		}
		if (body.kdf === 1 && body.kdfIterations < 2) {
			return errorResponse("Argon2id iterations must be at least 2", 400);
		}

		const passwordHash = await hashPasswordServer(
			body.masterPasswordHash,
			email,
		);
		const role = (await usersDb.getUserCount(db)) === 0 ? "admin" : "user";
		const userId = crypto.randomUUID();
		const ts = now();
		const statements = [
			db
				.insertInto("users")
				.values({
					id: userId,
					email,
					name: body.name ?? null,
					master_password_hash: passwordHash,
					master_password_hint: body.masterPasswordHint ?? null,
					key: body.key,
					private_key: body.keys?.encryptedPrivateKey ?? null,
					public_key: body.keys?.publicKey ?? null,
					kdf_type: body.kdf,
					kdf_iterations: body.kdfIterations,
					kdf_memory: body.kdfMemory ?? null,
					kdf_parallelism: body.kdfParallelism ?? null,
					security_stamp: crypto.randomUUID(),
					role,
					created_at: ts,
					updated_at: ts,
				})
				.compile(),
			revisionQuery(db, userId, ts),
		];
		if (invite) statements.push(db.updateTable("invites").set({ status: "used", used_by: userId, updated_at: ts }).where("code", "=", invite.code).where("status", "=", "active").compile());
		await executeBatch(c.get("dbDialect"), statements);
		return new Response(null, { status: 204 });
	},
);

export const publicPasswordHint = factory.createHandlers(
	async () => new Response(null, { status: 204 }),
);

function configPayload(origin: string, env: CloudflareBindings) { return {
	version: LIMITS.compatibility.bitwardenServerVersion,
	gitHash: null,
	server: { name: "edgewarden", url: origin },
	environment: {
		cloudRegion: null,
		vault: origin,
		api: `${origin}/api`,
		identity: `${origin}/identity`,
		notifications: null,
		icons: origin,
		fillAssistRules: `${origin}/fill-assist/`,
		sso: null,
		keyConnector: null,
	},
	featureStates: {
		"cipher-key-encryption":
			LIMITS.compatibility.cipherKeyEncryptionFeatureEnabled,
		"email-verification": false,
		"key-rotation-improvements": false,
		"fill-assist-targeting-rules": true,
		"pm-19051-send-email-verification": false,
		"pm-19148-innovation-archive": true,
	},
	turnstile: {
		enabled: turnstileEnabled(env),
		siteKey: turnstileSiteKey(env),
	},
	object: "config",
}; }

export const getConfig = factory.createHandlers(async (c) =>
	c.json(configPayload(new URL(c.req.url).origin, c.env)),
);

export const getVersion = factory.createHandlers(async (c) =>
	c.json({ version: LIMITS.compatibility.bitwardenServerVersion }),
);
