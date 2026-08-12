import { vValidator } from "@hono/valibot-validator";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { factory } from "../http/factory";
import {
	PasskeySecretSchema,
	TwoFactorPasskeyDeleteSchema,
	TwoFactorPasskeyRegistrationSchema,
} from "../schemas/passkeys";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import { invalidateUserCache, verifyPassword } from "../services/auth";
import { encryptCredential } from "../services/credential-protection";
import {
	conditionalRefreshTokenDeletionQuery,
	conditionalTwoFactorPasskeyClaimQuery,
	conditionalUserRevisionQuery,
	conditionalWebauthnCredentialDeletionClaimQuery,
	conditionalWebauthnCredentialDeletionQuery,
	conditionalWebauthnCredentialInsertQuery,
} from "../services/db/batch";
import * as webauthnDb from "../services/db/webauthn";
import {
	createAccountPasskeyToken,
	getAccountPasskeyRpConfig,
	normalizeAccountPasskeyName,
	normalizeAuthenticationResponse,
	normalizeRegistrationResponse,
	normalizeTransports,
	parseTransports,
	toSimpleWebAuthnCredential,
	userIdToWebAuthnUserId,
	verifyAccountPasskeyToken,
} from "../utils/account-passkeys";
import { bytesToBase64Url } from "../utils/passkey";
import { errorResponse, jsonResponse } from "../utils/response";
import { now } from "../utils/time";

const MAX_TWO_FACTOR_PASSKEYS = 5;

function recoveryCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(8));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
}

async function verifySecret(
	user: any,
	body: Record<string, any>,
): Promise<boolean> {
	const secret = String(
		body.masterPasswordHash ??
			body.master_password_hash ??
			body.secret ??
			body.password ??
			"",
	).trim();
	return (
		!!secret && verifyPassword(secret, user.master_password_hash, user.email)
	);
}

function settings(credentials: any[]) {
	return {
		enabled: credentials.length > 0,
		keys: credentials.map((credential) => ({
			id: credential.id,
			name: credential.name,
			migrated: false,
		})),
		object: "twoFactorWebAuthn",
	};
}

async function challengeHash(challenge: string): Promise<string> {
	return bytesToBase64Url(
		new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(challenge),
			),
		),
	);
}

export const getTwoFactorPasskeys = factory.createHandlers(
	vValidator("json", PasskeySecretSchema),
	async (c) => {
		if (!(await verifySecret(c.get("user"), c.req.valid("json"))))
			return errorResponse("Master password verification failed", 400);
		return jsonResponse(
			settings(
				await webauthnDb.listAccountPasskeyCredentialsByUserId(
					c.get("db"),
					c.get("user").id,
					"twoFactor",
				),
			),
		);
	},
);

export const getTwoFactorPasskeyChallenge = factory.createHandlers(
	vValidator("json", PasskeySecretSchema),
	async (c) => {
		const user = c.get("user");
		const db = c.get("db");
		if (!(await verifySecret(user, c.req.valid("json"))))
			return errorResponse("Master password verification failed", 400);
		const existing = await webauthnDb.listAccountPasskeyCredentialsByUserId(
			db,
			user.id,
			"twoFactor",
		);
		if (existing.length >= MAX_TWO_FACTOR_PASSKEYS)
			return errorResponse("Maximum two-factor passkey count reached", 400);
		const { rpId, rpName } = getAccountPasskeyRpConfig(c.req.raw, c.env);
		const options = await generateRegistrationOptions({
			rpID: rpId,
			rpName,
			userID: userIdToWebAuthnUserId(user.id) as any,
			userName: user.email,
			userDisplayName: user.name || user.email,
			attestationType: "none",
			authenticatorSelection: {
				userVerification: "required",
				residentKey: "discouraged",
			},
			excludeCredentials: existing.map((item) => ({
				id: item.credential_id,
				type: "public-key",
			})),
			supportedAlgorithmIDs: [-7, -257],
		});
		const ts = now();
		await webauthnDb.saveAccountPasskeyChallenge(db, {
			challenge_hash: await challengeHash(options.challenge),
			scope: "register",
			user_id: user.id,
			expires_at: ts + 7 * 60,
			used_at: null,
			created_at: ts,
		});
		const token = await createAccountPasskeyToken(c.env.JWT_SECRET, {
			scope: "CreateCredential",
			challenge: options.challenge,
			userId: user.id,
			rpId,
			purpose: "twoFactor",
		});
		return jsonResponse({
			options,
			token,
			object: "twoFactorWebAuthnChallenge",
		});
	},
);

export const createTwoFactorPasskey = factory.createHandlers(
	vValidator("json", TwoFactorPasskeyRegistrationSchema),
	async (c) => {
		const user = c.get("user");
		const db = c.get("db");
		const body = c.req.valid("json");
		if (!(await verifySecret(user, body)))
			return errorResponse("Master password verification failed", 400);
		const payload = await verifyAccountPasskeyToken(
			c.env.JWT_SECRET,
			body.token,
			"CreateCredential",
			"twoFactor",
		);
		if (!payload || payload.userId !== user.id)
			return errorResponse(
				"Passkey challenge token is invalid or expired",
				400,
			);
		if (
			!(await webauthnDb.consumeAccountPasskeyChallenge(
				db,
				await challengeHash(payload.challenge),
				"register",
				user.id,
			))
		)
			return errorResponse(
				"Passkey challenge has expired or was already used",
				400,
			);
		if (
			(await webauthnDb.countAccountPasskeyCredentialsByUserId(
				db,
				user.id,
				"twoFactor",
			)) >= MAX_TWO_FACTOR_PASSKEYS
		)
			return errorResponse("Maximum two-factor passkey count reached", 400);
		const response = normalizeRegistrationResponse(body.deviceResponse);
		if (!response)
			return errorResponse("Invalid passkey registration response", 400);
		const { origins } = getAccountPasskeyRpConfig(c.req.raw, c.env);
		let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
		try {
			verification = await verifyRegistrationResponse({
				response,
				expectedChallenge: payload.challenge,
				expectedOrigin: origins,
				expectedRPID: payload.rpId,
				requireUserPresence: true,
				requireUserVerification: true,
			});
		} catch {
			return errorResponse("Passkey registration could not be verified", 400);
		}
		if (!verification.verified)
			return errorResponse("Passkey registration could not be verified", 400);
		if (
			(await webauthnDb.getAccountPasskeyCredentialByCredentialId(
				db,
				verification.registrationInfo.credential.id,
				"twoFactor",
			)) ||
			(await webauthnDb.getAccountPasskeyCredentialByCredentialId(
				db,
				verification.registrationInfo.credential.id,
				"login",
			))
		)
			return errorResponse("Passkey is already registered", 409);
		const ts = now();
		const transports = normalizeTransports(response.response.transports);
		const credential = {
			id: crypto.randomUUID(),
			user_id: user.id,
			purpose: "twoFactor",
			name: normalizeAccountPasskeyName(body.name),
			public_key: bytesToBase64Url(
				verification.registrationInfo.credential.publicKey,
			),
			credential_id: verification.registrationInfo.credential.id,
			counter: verification.registrationInfo.credential.counter,
			type: verification.registrationInfo.credentialType || "public-key",
			aa_guid: verification.registrationInfo.aaguid || null,
			transports: transports ? JSON.stringify(transports) : null,
			encrypted_user_key: null,
			encrypted_public_key: null,
			encrypted_private_key: null,
			supports_prf: 0,
			created_at: ts,
			updated_at: ts,
		};
		const encryptedRecoveryCode =
			user.totp_recovery_code ??
			(await encryptCredential(
				recoveryCode(),
				c.env.DATA_ENCRYPTION_SECRET,
				"totp-recovery",
			));
		const securityStamp = crypto.randomUUID();
		const [claimed, inserted] = await c
			.get("dbDialect")
			.batch([
				conditionalTwoFactorPasskeyClaimQuery(
					db,
					user.id,
					user.security_stamp,
					credential.credential_id,
					encryptedRecoveryCode,
					securityStamp,
					MAX_TWO_FACTOR_PASSKEYS,
					ts,
				),
				conditionalWebauthnCredentialInsertQuery(db, credential, securityStamp),
				conditionalRefreshTokenDeletionQuery(db, user.id, securityStamp),
				conditionalUserRevisionQuery(db, user.id, securityStamp, ts),
			]);
		if (claimed.numAffectedRows !== 1n)
			return errorResponse(
				"Passkey settings changed or reached their limit",
				409,
			);
		if (inserted.numAffectedRows !== 1n)
			return errorResponse("Passkey registration could not be persisted", 500);
		invalidateUserCache(user.id);
		await safeWriteAuditEvent(db, {
			actorUserId: user.id,
			action: "account.two_factor.passkey.create",
			category: "auth",
			targetType: "twoFactorPasskey",
			targetId: credential.id,
			metadata: auditRequestMetadata(c.req.raw),
		});
		return jsonResponse(
			settings(
				await webauthnDb.listAccountPasskeyCredentialsByUserId(
					db,
					user.id,
					"twoFactor",
				),
			),
		);
	},
);

export const deleteTwoFactorPasskey = factory.createHandlers(
	vValidator("json", TwoFactorPasskeyDeleteSchema),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		if (!(await verifySecret(user, body)))
			return errorResponse("Master password verification failed", 400);
		const db = c.get("db");
		const existing = await db
			.selectFrom("webauthn_credentials")
			.select("id")
			.where("id", "=", body.id)
			.where("user_id", "=", user.id)
			.where("purpose", "=", "twoFactor")
			.executeTakeFirst();
		if (!existing) return errorResponse("Two-factor passkey not found", 404);
		const ts = now();
		const securityStamp = crypto.randomUUID();
		const [claimed, deleted] = await c
			.get("dbDialect")
			.batch([
				conditionalWebauthnCredentialDeletionClaimQuery(
					db,
					user.id,
					body.id,
					"twoFactor",
					user.security_stamp,
					securityStamp,
					ts,
				),
				conditionalWebauthnCredentialDeletionQuery(
					db,
					user.id,
					body.id,
					"twoFactor",
					securityStamp,
				),
				conditionalRefreshTokenDeletionQuery(db, user.id, securityStamp),
				conditionalUserRevisionQuery(db, user.id, securityStamp, ts),
			]);
		if (claimed.numAffectedRows !== 1n)
			return errorResponse("Passkey settings changed by another request", 409);
		if (deleted.numAffectedRows !== 1n)
			return errorResponse("Passkey deletion could not be persisted", 500);
		invalidateUserCache(user.id);
		await safeWriteAuditEvent(db, {
			actorUserId: user.id,
			action: "account.two_factor.passkey.delete",
			category: "auth",
			targetType: "twoFactorPasskey",
			targetId: body.id,
			metadata: auditRequestMetadata(c.req.raw),
		});
		return jsonResponse(
			settings(
				await webauthnDb.listAccountPasskeyCredentialsByUserId(
					db,
					user.id,
					"twoFactor",
				),
			),
		);
	},
);

export async function buildTwoFactorPasskeyAssertion(
	request: Request,
	env: CloudflareBindings,
	db: any,
	userId: string,
) {
	const credentials = await webauthnDb.listAccountPasskeyCredentialsByUserId(
		db,
		userId,
		"twoFactor",
	);
	if (!credentials.length) return null;
	const { rpId } = getAccountPasskeyRpConfig(request, env);
	const options = await generateAuthenticationOptions({
		rpID: rpId,
		allowCredentials: credentials.map((item) => ({
			id: item.credential_id,
			transports: (parseTransports(item.transports) || undefined) as any,
		})),
		userVerification: "required",
		timeout: 60_000,
	});
	const ts = now();
	await webauthnDb.saveAccountPasskeyChallenge(db, {
		challenge_hash: await challengeHash(options.challenge),
		scope: "action",
		user_id: userId,
		expires_at: ts + 7 * 60,
		used_at: null,
		created_at: ts,
	});
	const token = await createAccountPasskeyToken(env.JWT_SECRET, {
		scope: "Authentication",
		challenge: options.challenge,
		userId,
		rpId,
		purpose: "twoFactor",
	});
	return { options, token };
}

export async function assertTwoFactorPasskey(
	request: Request,
	env: CloudflareBindings,
	db: any,
	userId: string,
	input: { token: string; deviceResponse: unknown },
): Promise<void> {
	const payload = await verifyAccountPasskeyToken(
		env.JWT_SECRET,
		input.token,
		"Authentication",
		"twoFactor",
	);
	if (!payload || payload.userId !== userId)
		throw new Error("Invalid two-factor passkey challenge");
	const response = normalizeAuthenticationResponse(input.deviceResponse);
	if (
		!response ||
		!(await webauthnDb.consumeAccountPasskeyChallenge(
			db,
			await challengeHash(payload.challenge),
			"action",
			userId,
		))
	)
		throw new Error("Invalid or expired two-factor passkey challenge");
	const credential = await webauthnDb.getAccountPasskeyCredentialByCredentialId(
		db,
		response.rawId,
		"twoFactor",
	);
	if (!credential || credential.user_id !== userId)
		throw new Error("Two-factor passkey is not registered");
	const { origins } = getAccountPasskeyRpConfig(request, env);
	const verification = await verifyAuthenticationResponse({
		response,
		expectedChallenge: payload.challenge,
		expectedOrigin: origins,
		expectedRPID: payload.rpId,
		credential: toSimpleWebAuthnCredential(credential),
		requireUserVerification: true,
		advancedFIDOConfig: { userVerification: "required" },
	});
	if (!verification.verified || !verification.authenticationInfo.userVerified)
		throw new Error("Two-factor passkey verification failed");
	await webauthnDb.updateAccountPasskeyCounter(
		db,
		userId,
		credential.credential_id,
		verification.authenticationInfo.newCounter,
	);
}
