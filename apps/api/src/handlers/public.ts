import { vValidator } from "@hono/valibot-validator";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { checkIpRateLimit } from "../middleware/rate-limit";
import { RegisterSchema } from "../schemas/accounts";
import { hashPasswordServer } from "../services/auth";
import { hashCredential } from "../services/credential-protection";
import { executeBatch, revisionQuery } from "../services/db/batch";
import { getConfigValue } from "../services/db/config";
import * as usersDb from "../services/db/users";
import {
	adminPasswordConfigured,
	BOOTSTRAP_LOCK_KEY,
	inviteConsumptionLockKey,
	loadRegistrationPolicy,
	verifyBootstrapSecret,
} from "../services/registration-policy";
import {
	turnstileEnabled,
	turnstileSiteKey,
	verifyTurnstileToken,
} from "../services/turnstile";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";
import { EDGEWARDEN_VERSION } from "@edgewarden/shared";

export const registerAccount = factory.createHandlers(
	vValidator("json", RegisterSchema),
	async (c) => {
		if (!(await checkIpRateLimit(c))) {
			return errorResponse("Too many registration attempts", 429);
		}
		const body = c.req.valid("json");
		if (
			turnstileEnabled(c.env) &&
			!(await verifyTurnstileToken(
				c.env,
				body.captchaResponse ?? "",
				"register",
				c.req.header("CF-Connecting-IP"),
			))
		) {
			return errorResponse("Captcha verification failed", 400);
		}
		const db = c.get("db");
		const email = body.email.toLowerCase();
		const policy = await loadRegistrationPolicy(db, c.env);
		const [userCount, bootstrapLock] = await Promise.all([
			usersDb.getUserCount(db),
			getConfigValue(db, BOOTSTRAP_LOCK_KEY),
		]);
		const isBootstrap = userCount === 0 && !bootstrapLock;
		if (userCount === 0 && bootstrapLock)
			return errorResponse("Bootstrap has already been completed", 403);

		const inviteCode = body.inviteCode?.trim();
		const inviteCodeHash = inviteCode ? await hashCredential(inviteCode) : null;
		const invite =
			inviteCodeHash && policy.invitationsAllowed
				? await db
						.selectFrom("invites")
						.selectAll()
						.where("code", "=", inviteCodeHash)
						.where("status", "=", "active")
						.where("expires_at", ">", now())
						.executeTakeFirst()
				: null;
		if (inviteCode && !invite)
			return errorResponse("Invite is invalid or expired", 400);
		if (invite && invite.email?.trim().toLowerCase() !== email) {
			return errorResponse("Invite does not match this email address", 400);
		}
		if (isBootstrap) {
			if (!(await verifyBootstrapSecret(c.env, body.adminPassword))) {
				return errorResponse(
					"Admin password is required to create the first account",
					403,
				);
			}
		} else if (!policy.signupsAllowed && !invite) {
			return errorResponse("Registration is disabled", 403);
		}
		if (await usersDb.getUserByEmail(db, email)) {
			return errorResponse("Email already taken.", 400);
		}
		if (body.kdf === 0 && body.kdfIterations < 100_000) {
			return errorResponse("PBKDF2 iterations must be at least 100000", 400);
		}
		if (body.kdf === 1 && body.kdfIterations < 2) {
			return errorResponse("Argon2id iterations must be at least 2", 400);
		}
		if (
			body.kdf === 1 &&
			(!Number.isInteger(body.kdfMemory) ||
				(body.kdfMemory ?? 0) < 8 ||
				!Number.isInteger(body.kdfParallelism) ||
				(body.kdfParallelism ?? 0) < 1)
		) {
			return errorResponse(
				"Argon2id memory must be at least 8 MiB and parallelism at least 1",
				400,
			);
		}

		const passwordHash = await hashPasswordServer(
			body.masterPasswordHash,
			email,
		);
		const role = isBootstrap ? "admin" : "user";
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
		if (isBootstrap)
			statements.unshift(
				db
					.insertInto("config")
					.values({ key: BOOTSTRAP_LOCK_KEY, value: userId })
					.compile(),
			);
		if (invite)
			statements.push(
				db
					.insertInto("config")
					.values({ key: inviteConsumptionLockKey(invite.code), value: userId })
					.compile(),
				db
					.updateTable("invites")
					.set({ status: "used", used_by: userId, updated_at: ts })
					.where("code", "=", invite.code)
					.where("status", "=", "active")
					.compile(),
			);
		try {
			await executeBatch(c.get("dbDialect"), statements);
		} catch (error) {
			if (isBootstrap || invite)
				return errorResponse("Registration was already completed", 409);
			throw error;
		}
		return new Response(null, { status: 204 });
	},
);

export const publicPasswordHint = factory.createHandlers(
	async () => new Response(null, { status: 204 }),
);

function configPayload(
	origin: string,
	env: CloudflareBindings,
	bootstrapRequired: boolean,
	registration: Awaited<ReturnType<typeof loadRegistrationPolicy>>,
) {
	return {
		version: LIMITS.compatibility.bitwardenServerVersion,
		edgewardenVersion: EDGEWARDEN_VERSION,
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
		registration: {
			signupsAllowed: registration.signupsAllowed,
			invitationsAllowed: registration.invitationsAllowed,
			bootstrapRequired,
			adminPasswordConfigured: adminPasswordConfigured(env),
		},
		object: "config",
	};
}

export const getConfig = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const [userCount, bootstrapLock, registration] = await Promise.all([
		usersDb.getUserCount(db),
		getConfigValue(db, BOOTSTRAP_LOCK_KEY),
		loadRegistrationPolicy(db, c.env),
	]);
	const bootstrapRequired = userCount === 0 && !bootstrapLock;
	return c.json(
		configPayload(
			new URL(c.req.url).origin,
			c.env,
			bootstrapRequired,
			registration,
		),
	);
});

export const getVersion = factory.createHandlers(async (c) =>
	c.json({
		version: LIMITS.compatibility.bitwardenServerVersion,
		edgewardenVersion: EDGEWARDEN_VERSION,
	}),
);
