import { vValidator } from "@hono/valibot-validator";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { type Selectable, sql } from "kysely";
import { factory } from "../../http/factory";
import {
	PasskeyAssertionOptionsSchema,
	PasskeyEncryptionSchema,
	PasskeyRegistrationSchema,
	PasskeySecretSchema,
} from "../../schemas/passkeys";
import {
	assertAccountPasskeyCredential,
	handleGetAccountPasskeyAssertionOptions,
	verifyUserSecret,
} from "../../services/account-passkey-auth";
import {
	auditEventInsertQuery,
	auditRequestMetadata,
} from "../../services/audit";
import { invalidateUserCache } from "../../services/auth";
import {
	conditionalAccountPasskeyClaimQuery,
	conditionalRefreshTokenDeletionQuery,
	conditionalUserRevisionQuery,
	conditionalWebauthnChallengeConsumptionQuery,
	conditionalWebauthnCredentialDeletionClaimQuery,
	conditionalWebauthnCredentialDeletionQuery,
	conditionalWebauthnCredentialInsertQuery,
	conditionalWebauthnEncryptionRevisionQuery,
	conditionalWebauthnEncryptionUpdateQuery,
} from "../../services/db/batch";
import * as webauthnDb from "../../services/db/webauthn";
import type { WebauthnCredentials } from "../../types/db";
import {
	accountPasskeyCredentialToResponse,
	accountPasskeyPrfStatus,
	buildWebAuthnPrfOption,
	createAccountPasskeyToken,
	getAccountPasskeyRpConfig,
	isSerializedEncString,
	normalizeAccountPasskeyName,
	normalizeRegistrationResponse,
	normalizeTransports,
	parseTransports,
	userIdToWebAuthnUserId,
	verifyAccountPasskeyToken,
} from "../../utils/account-passkeys";
import { bytesToBase64Url } from "../../utils/passkey";
import { errorResponse, jsonResponse } from "../../utils/response";
import { now } from "../../utils/time";

const MAX_ACCOUNT_PASSKEYS = 5;

// WebAuthn challenges are persisted before returning options so assertions can be consumed exactly once.
export const listAccountPasskeys = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const user = c.get("user");
	const credentials = await webauthnDb.listAccountPasskeyCredentialsByUserId(
		db,
		user.id,
	);
	return jsonResponse({
		data: credentials.map(accountPasskeyCredentialToResponse),
		Data: credentials.map(accountPasskeyCredentialToResponse),
		object: "list",
		Object: "list",
		continuationToken: null,
		ContinuationToken: null,
	});
});

// POST /api/webauthn/attestation-options
export const getAccountPasskeyAttestationOptions = factory.createHandlers(
	vValidator("json", PasskeySecretSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const body = c.req.valid("json");

		if (!(await verifyUserSecret(user, body))) {
			return errorResponse("Master password verification failed", 400);
		}

		const credentials = await webauthnDb.listAccountPasskeyCredentialsByUserId(
			db,
			user.id,
		);
		if (credentials.length >= MAX_ACCOUNT_PASSKEYS) {
			return errorResponse("Maximum passkey count reached", 400);
		}

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
				residentKey: "required",
			},
			excludeCredentials: credentials.map((cred) => ({
				id: cred.credential_id,
				type: "public-key",
			})),
			supportedAlgorithmIDs: [-7, -257], // ES256, RS256
		});

		const ts = now();
		const challengeBytes = new TextEncoder().encode(options.challenge);
		const challengeHashBuf = await crypto.subtle.digest(
			"SHA-256",
			challengeBytes,
		);
		const challengeHash = bytesToBase64Url(new Uint8Array(challengeHashBuf));

		await webauthnDb.saveAccountPasskeyChallenge(db, {
			challenge_hash: challengeHash,
			scope: "register", // 'register' maps to 'CreateCredential'
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
			purpose: "login",
		});

		return jsonResponse({
			options,
			token,
			object: "webAuthnRegisterAttestationOptions",
			Object: "webAuthnRegisterAttestationOptions",
		});
	},
);

// POST /api/webauthn/assertion-options
export const getAccountPasskeyActionAssertionOptions = factory.createHandlers(
	vValidator("json", PasskeyAssertionOptionsSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const body = c.req.valid("json");

		if (!(await verifyUserSecret(user, body))) {
			return errorResponse("Master password verification failed", 400);
		}

		let credentials = await webauthnDb.listAccountPasskeyCredentialsByUserId(
			db,
			user.id,
		);
		const requestedId = String(body.credentialId || body.id || "").trim();
		if (requestedId) {
			credentials = credentials.filter((cred) => cred.id === requestedId);
			if (!credentials.length)
				return errorResponse("Account passkey not found", 404);
		}
		if (!credentials.length)
			return errorResponse("No account passkeys registered", 404);

		const { rpId } = getAccountPasskeyRpConfig(c.req.raw, c.env);
		const options = await generateAuthenticationOptions({
			rpID: rpId,
			allowCredentials: credentials.map((cred) => ({
				id: cred.credential_id,
				transports: (parseTransports(cred.transports) || undefined) as any,
			})),
			userVerification: "required",
			timeout: 60000,
		});

		const ts = now();
		const challengeBytes = new TextEncoder().encode(options.challenge);
		const challengeHashBuf = await crypto.subtle.digest(
			"SHA-256",
			challengeBytes,
		);
		const challengeHash = bytesToBase64Url(new Uint8Array(challengeHashBuf));

		await webauthnDb.saveAccountPasskeyChallenge(db, {
			challenge_hash: challengeHash,
			scope: "action", // 'action' maps to 'UpdateKeySet'
			user_id: user.id,
			expires_at: ts + 17 * 60,
			used_at: null,
			created_at: ts,
		});

		const token = await createAccountPasskeyToken(c.env.JWT_SECRET, {
			scope: "UpdateKeySet",
			challenge: options.challenge,
			userId: user.id,
			rpId,
			purpose: "login",
		});

		return jsonResponse({
			options,
			token,
			object: "webAuthnLoginAssertionOptions",
			Object: "webAuthnLoginAssertionOptions",
		});
	},
);

// POST /api/webauthn
