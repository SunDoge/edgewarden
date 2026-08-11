import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import {
	ChangePasswordSchema,
	SetKeysSchema,
	UpdateProfileSchema,
	VerifyPasswordSchema,
} from "../schemas/accounts";
import {
	hashPasswordServer,
	invalidateUserCache,
	verifyPassword,
} from "../services/auth";
import { executeBatch, revisionQuery } from "../services/db/batch";
import {
	decryptCredential,
	encryptCredential,
	hashCredential,
} from "../services/credential-protection";
import * as revisionsDb from "../services/db/revisions";
import * as usersDb from "../services/db/users";
import * as webauthnDb from "../services/db/webauthn";
import { userYubicoPublicIds } from "../utils/yubico";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";

function buildProfileResponse(
	user: NonNullable<Awaited<ReturnType<typeof usersDb.getUserById>>>,
	twoFactorPasskeys = 0,
) {
	return {
		id: user.id,
		name: user.name,
		email: user.email,
		emailVerified: true,
		premium: true,
		premiumFromOrganization: false,
		masterPasswordHint: user.master_password_hint,
		culture: "en-US",
		twoFactorEnabled:
			!!user.totp_secret ||
			twoFactorPasskeys > 0 ||
			userYubicoPublicIds(user as any).length > 0,
		key: user.key,
		privateKey: user.private_key,
		publicKey: user.public_key,
		securityStamp: user.security_stamp,
		forcePasswordReset: false,
		usesKeyConnector: false,
		avatarColor: null,
		kdf: user.kdf_type,
		kdfIterations: user.kdf_iterations,
		kdfMemory: user.kdf_memory ?? null,
		kdfParallelism: user.kdf_parallelism ?? null,
		creationDate: toIso(user.created_at),
		object: "profile",
	};
}

// GET /api/accounts/profile
export const getProfile = factory.createHandlers(async (c) => {
	const user = c.get("user");
	const count = await webauthnDb.countAccountPasskeyCredentialsByUserId(
		c.get("db"),
		user.id,
		"twoFactor",
	);
	return c.json(buildProfileResponse(user, count));
});

// PUT /api/accounts/profile
export const updateProfile = factory.createHandlers(
	vValidator("json", UpdateProfileSchema),
	async (c) => {
		const body = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");

		await usersDb.updateUser(db, user.id, {
			name: body.name ?? user.name,
			master_password_hint:
				body.masterPasswordHint ?? user.master_password_hint,
			updated_at: now(),
		});
		invalidateUserCache(user.id);

		const updated = await usersDb.getUserById(db, user.id);
		if (!updated) return errorResponse("Profile not found", 404);
		const count = await webauthnDb.countAccountPasskeyCredentialsByUserId(
			db,
			user.id,
			"twoFactor",
		);
		return c.json(buildProfileResponse(updated, count));
	},
);

// POST /api/accounts/keys
export const setKeys = factory.createHandlers(
	vValidator("json", SetKeysSchema),
	async (c) => {
		const body = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");

		await usersDb.updateUser(db, user.id, {
			public_key: body.publicKey,
			private_key: body.encryptedPrivateKey,
			updated_at: now(),
		});
		invalidateUserCache(user.id);
		return new Response(null, { status: 200 });
	},
);

// POST /api/accounts/password (change password)
export const changePassword = factory.createHandlers(
	vValidator("json", ChangePasswordSchema),
	async (c) => {
		const body = c.req.valid("json");
		const user = c.get("user");
		const db = c.get("db");

		const valid = await verifyPassword(
			body.masterPasswordHash,
			user.master_password_hash,
			user.email,
		);
		if (!valid) return errorResponse("Current password is incorrect.", 400);

		const newHash = await hashPasswordServer(
			body.newMasterPasswordHash,
			user.email,
		);
		const newStamp = crypto.randomUUID();

		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("users")
				.set({
					master_password_hash: newHash,
					master_password_hint:
						body.masterPasswordHint ?? user.master_password_hint,
					key: body.key,
					security_stamp: newStamp,
					updated_at: ts,
				})
				.where("id", "=", user.id)
				.compile(),
			db.deleteFrom("refresh_tokens").where("user_id", "=", user.id).compile(),
			revisionQuery(db, user.id, ts),
		]);

		invalidateUserCache(user.id);
		return new Response(null, { status: 200 });
	},
);

// POST /api/accounts/verify-password
export const verifyAccountPassword = factory.createHandlers(
	vValidator("json", VerifyPasswordSchema),
	async (c) => {
		const { masterPasswordHash } = c.req.valid("json");
		const user = c.get("user");

		const valid = await verifyPassword(
			masterPasswordHash,
			user.master_password_hash,
			user.email,
		);
		if (!valid) return errorResponse("Invalid password.", 400);
		return new Response(null, { status: 200 });
	},
);

// GET /api/accounts/revision-date
export const getRevisionDate = factory.createHandlers(async (c) => {
	const user = c.get("user");
	const db = c.get("db");
	const revisionDate = await revisionsDb.getRevisionDate(db, user.id);
	return c.json(revisionDate);
});

// POST /api/accounts/password-hint
export const requestPasswordHint = factory.createHandlers(async () => {
	// Never reveal hint over API — Bitwarden sends it via email
	// For self-hosted: just return 200 (or implement email later)
	return new Response(null, { status: 200 });
});

// GET /api/accounts/api-key
// POST /api/accounts/rotate-api-key
export const getApiKey = factory.createHandlers(async (c) => {
	const user = c.get("user");
	const db = c.get("db");
	let key: string;
	if (user.api_key_encrypted) {
		try {
			key = await decryptCredential(
				user.api_key_encrypted,
				c.env.DATA_ENCRYPTION_SECRET,
				"api-key",
			);
		} catch {
			return errorResponse("Stored API key cannot be decrypted", 500);
		}
	} else {
		key = crypto.randomUUID().replace(/-/g, "");
		await usersDb.updateUser(db, user.id, {
			api_key_hash: await hashCredential(key),
			api_key_encrypted: await encryptCredential(
				key,
				c.env.DATA_ENCRYPTION_SECRET,
				"api-key",
			),
			updated_at: now(),
		});
		invalidateUserCache(user.id);
	}
	return c.json({ apiKey: key, object: "apiKey" });
});

export const rotateApiKey = factory.createHandlers(async (c) => {
	const user = c.get("user");
	const db = c.get("db");
	const key = crypto.randomUUID().replace(/-/g, "");
	await usersDb.updateUser(db, user.id, {
		api_key_hash: await hashCredential(key),
		api_key_encrypted: await encryptCredential(
			key,
			c.env.DATA_ENCRYPTION_SECRET,
			"api-key",
		),
		updated_at: now(),
	});
	invalidateUserCache(user.id);
	return c.json({ apiKey: key, object: "apiKey" });
});
