import { vValidator } from "@hono/valibot-validator";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { D1Dialect } from "@sundoge/kysely-d1";
import { sql } from "kysely";
import { factory } from "../../http/factory";
import {
	PasskeySecretSchema,
	TwoFactorPasskeyDeleteSchema,
	TwoFactorPasskeyRegistrationSchema,
} from "../../schemas/passkeys";
import { auditEventInsertQuery, auditRequestMetadata } from "../../services/audit";
import { invalidateUserCache, verifyPassword } from "../../services/auth";
import { encryptCredential } from "../../services/credential-protection";
import {
	conditionalRefreshTokenDeletionQuery,
	conditionalTwoFactorPasskeyClaimQuery,
	conditionalUserRevisionQuery,
	conditionalWebauthnChallengeConsumptionQuery,
	conditionalWebauthnCredentialDeletionClaimQuery,
	conditionalWebauthnCredentialDeletionQuery,
	conditionalWebauthnCredentialInsertQuery,
} from "../../services/db/batch";
import * as webauthnDb from "../../services/db/webauthn";
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
} from "../../utils/account-passkeys";
import { bytesToBase64Url } from "../../utils/passkey";
import { errorResponse, jsonResponse } from "../../utils/response";
import { now } from "../../utils/time";

import { challengeHash, MAX_TWO_FACTOR_PASSKEYS, recoveryCode, settings, verifySecret } from "./shared";

// Registration and deletion bind credential changes, recovery material, revision writes, and audit records in guarded D1 batches.
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
		const registrationChallengeHash = await challengeHash(payload.challenge);
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
			mutation_token: crypto.randomUUID(),
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
		const [claimed, inserted, consumed] = await c.get("dbDialect").batch([
			conditionalTwoFactorPasskeyClaimQuery(
				db,
				user.id,
				user.security_stamp,
				credential.credential_id,
				encryptedRecoveryCode,
				securityStamp,
				MAX_TWO_FACTOR_PASSKEYS,
				ts,
				{ hash: registrationChallengeHash, scope: "register" },
			),
			conditionalWebauthnCredentialInsertQuery(db, credential, securityStamp),
			conditionalWebauthnChallengeConsumptionQuery(db, {
				challengeHash: registrationChallengeHash,
				scope: "register",
				userId: user.id,
				credentialId: credential.credential_id,
				mutationToken: credential.mutation_token,
				timestamp: ts,
			}),
			conditionalRefreshTokenDeletionQuery(db, user.id, securityStamp),
			conditionalUserRevisionQuery(db, user.id, securityStamp, ts),
			auditEventInsertQuery(
				db,
				{
					actorUserId: user.id,
					action: "account.two_factor.passkey.create",
					category: "auth",
					targetType: "twoFactorPasskey",
					targetId: credential.id,
					metadata: auditRequestMetadata(c.req.raw),
				},
				sql<boolean>`EXISTS (
						SELECT 1 FROM webauthn_credentials
						WHERE id = ${credential.id}
						  AND mutation_token = ${credential.mutation_token}
					)`,
				ts,
			),
		]);
		if (claimed.numAffectedRows !== 1n)
			return errorResponse(
				"Passkey settings changed or reached their limit",
				409,
			);
		if (inserted.numAffectedRows !== 1n)
			return errorResponse("Passkey registration could not be persisted", 500);
		if (consumed.numAffectedRows !== 1n)
			return errorResponse("Passkey challenge could not be consumed", 500);
		invalidateUserCache(user.id);
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
		const [claimed, deleted] = await c.get("dbDialect").batch([
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
			auditEventInsertQuery(
				db,
				{
					actorUserId: user.id,
					action: "account.two_factor.passkey.delete",
					category: "auth",
					targetType: "twoFactorPasskey",
					targetId: body.id,
					metadata: auditRequestMetadata(c.req.raw),
				},
				sql<boolean>`EXISTS (
							SELECT 1 FROM users
							WHERE id = ${user.id} AND security_stamp = ${securityStamp}
						)`,
				ts,
			),
		]);
		if (claimed.numAffectedRows !== 1n)
			return errorResponse("Passkey settings changed by another request", 409);
		if (deleted.numAffectedRows !== 1n)
			return errorResponse("Passkey deletion could not be persisted", 500);
		invalidateUserCache(user.id);
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
