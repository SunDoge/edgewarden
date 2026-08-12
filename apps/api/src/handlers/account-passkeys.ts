import { vValidator } from "@hono/valibot-validator";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { Selectable } from "kysely";
import { factory } from "../http/factory";
import {
	PasskeyAssertionOptionsSchema,
	PasskeyEncryptionSchema,
	PasskeyRegistrationSchema,
	PasskeySecretSchema,
} from "../schemas/passkeys";
import {
	assertAccountPasskeyCredential,
	handleGetAccountPasskeyAssertionOptions,
	verifyUserSecret,
} from "../services/account-passkey-auth";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import { invalidateUserCache } from "../services/auth";
import {
	conditionalAccountPasskeyClaimQuery,
	conditionalRefreshTokenDeletionQuery,
	conditionalUserRevisionQuery,
	conditionalWebauthnCredentialDeletionClaimQuery,
	conditionalWebauthnCredentialDeletionQuery,
	conditionalWebauthnCredentialInsertQuery,
	webauthnCredentialRevisionQuery,
} from "../services/db/batch";
import * as webauthnDb from "../services/db/webauthn";
import type { WebauthnCredentials } from "../types/db";
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
} from "../utils/account-passkeys";
import { bytesToBase64Url } from "../utils/passkey";
import { errorResponse, jsonResponse } from "../utils/response";
import { now } from "../utils/time";

const MAX_ACCOUNT_PASSKEYS = 5;

function hasCompletePrfKeySet(body: Record<string, any>): boolean {
	return !!(
		body.encryptedUserKey &&
		body.encryptedPublicKey &&
		body.encryptedPrivateKey
	);
}

function readPrfKeySet(body: Record<string, any>): {
	encryptedUserKey: string | null;
	encryptedPublicKey: string | null;
	encryptedPrivateKey: string | null;
} {
	if (!hasCompletePrfKeySet(body)) {
		return {
			encryptedUserKey: null,
			encryptedPublicKey: null,
			encryptedPrivateKey: null,
		};
	}
	const encryptedUserKey = String(body.encryptedUserKey).trim();
	const encryptedPublicKey = String(body.encryptedPublicKey).trim();
	const encryptedPrivateKey = String(body.encryptedPrivateKey).trim();
	if (
		!isSerializedEncString(encryptedUserKey) ||
		!isSerializedEncString(encryptedPublicKey) ||
		!isSerializedEncString(encryptedPrivateKey)
	) {
		throw new Error("Invalid encrypted key set");
	}
	return { encryptedUserKey, encryptedPublicKey, encryptedPrivateKey };
}

export {
	assertAccountPasskeyCredential,
	handleGetAccountPasskeyAssertionOptions,
};
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
export const createAccountPasskey = factory.createHandlers(
	vValidator("json", PasskeyRegistrationSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const body = c.req.valid("json");

		const payload = await verifyAccountPasskeyToken(
			c.env.JWT_SECRET,
			String(body.token || ""),
			"CreateCredential",
			"login",
		);
		if (!payload || payload.userId !== user.id) {
			return errorResponse(
				"Passkey challenge token is invalid or expired",
				400,
			);
		}

		const challengeBytes = new TextEncoder().encode(payload.challenge);
		const challengeHashBuf = await crypto.subtle.digest(
			"SHA-256",
			challengeBytes,
		);
		const challengeHash = bytesToBase64Url(new Uint8Array(challengeHashBuf));

		const ts = now();
		const consumed = await webauthnDb.consumeAccountPasskeyChallenge(
			db,
			challengeHash,
			"register",
			user.id,
		);
		if (!consumed) {
			return errorResponse(
				"Passkey challenge has expired or was already used",
				400,
			);
		}

		const currentCount =
			await webauthnDb.countAccountPasskeyCredentialsByUserId(db, user.id);
		if (currentCount >= MAX_ACCOUNT_PASSKEYS) {
			return errorResponse("Maximum passkey count reached", 400);
		}

		let prfKeySet: ReturnType<typeof readPrfKeySet>;
		try {
			prfKeySet = readPrfKeySet(body);
		} catch {
			return errorResponse("Invalid encrypted passkey key set", 400);
		}

		const registrationResponse = normalizeRegistrationResponse(
			body.deviceResponse,
		);
		if (!registrationResponse) {
			return errorResponse("Invalid passkey registration response", 400);
		}

		const { origins } = getAccountPasskeyRpConfig(c.req.raw, c.env);
		let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
		try {
			verification = await verifyRegistrationResponse({
				response: registrationResponse,
				expectedChallenge: payload.challenge,
				expectedOrigin: origins,
				expectedRPID: payload.rpId,
				requireUserPresence: true,
				requireUserVerification: true,
			});
		} catch {
			return errorResponse("Passkey registration could not be verified", 400);
		}

		if (!verification.verified) {
			return errorResponse("Passkey registration could not be verified", 400);
		}

		const existing = await webauthnDb.getAccountPasskeyCredentialByCredentialId(
			db,
			verification.registrationInfo.credential.id,
		);
		if (existing) {
			return errorResponse("Passkey is already registered", 409);
		}

		const supportsPrf = !!body.supportsPrf || hasCompletePrfKeySet(body);
		const transports = normalizeTransports(
			registrationResponse.response.transports,
		);
		const credentialId = crypto.randomUUID();

		const credential = {
			id: credentialId,
			user_id: user.id,
			purpose: "login",
			name: normalizeAccountPasskeyName(body.name),
			public_key: bytesToBase64Url(
				verification.registrationInfo.credential.publicKey,
			),
			credential_id: verification.registrationInfo.credential.id,
			counter: verification.registrationInfo.credential.counter,
			type: verification.registrationInfo.credentialType || "public-key",
			aa_guid: verification.registrationInfo.aaguid || null,
			transports: transports ? JSON.stringify(transports) : null,
			encrypted_user_key: prfKeySet.encryptedUserKey,
			encrypted_public_key: prfKeySet.encryptedPublicKey,
			encrypted_private_key: prfKeySet.encryptedPrivateKey,
			supports_prf: supportsPrf ? 1 : 0,
			created_at: ts,
			updated_at: ts,
		};

		const securityStamp = crypto.randomUUID();
		const [claimed, inserted] = await c
			.get("dbDialect")
			.batch([
				conditionalAccountPasskeyClaimQuery(
					db,
					user.id,
					user.security_stamp,
					credential.credential_id,
					securityStamp,
					MAX_ACCOUNT_PASSKEYS,
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
			action: "account.passkey.create",
			category: "system",
			level: "info",
			targetType: "accountPasskey",
			targetId: credential.id,
			metadata: {
				prfStatus: accountPasskeyPrfStatus(credential),
				...auditRequestMetadata(c.req.raw),
			},
		});

		return jsonResponse(accountPasskeyCredentialToResponse(credential as any));
	},
);

// PUT /api/webauthn
export const updateAccountPasskeyEncryption = factory.createHandlers(
	vValidator("json", PasskeyEncryptionSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const body = c.req.valid("json");

		let prfKeySet: ReturnType<typeof readPrfKeySet>;
		try {
			prfKeySet = readPrfKeySet(body);
		} catch {
			return errorResponse("Invalid encrypted passkey key set", 400);
		}
		if (
			!prfKeySet.encryptedUserKey ||
			!prfKeySet.encryptedPublicKey ||
			!prfKeySet.encryptedPrivateKey
		) {
			return errorResponse("Encrypted passkey key set is required", 400);
		}

		let assertion: Awaited<ReturnType<typeof assertAccountPasskeyCredential>>;
		try {
			assertion = await assertAccountPasskeyCredential(c.req.raw, c.env, db, {
				token: String(body.token || ""),
				deviceResponse: body.deviceResponse,
				scope: "UpdateKeySet",
				expectedUserId: user.id,
			});
		} catch (error: any) {
			return errorResponse(error.message || "Passkey assertion failed", 400);
		}

		const ts = now();
		const [updated] = await c.get("dbDialect").batch([
			db
				.updateTable("webauthn_credentials")
				.set({
					encrypted_user_key: prfKeySet.encryptedUserKey,
					encrypted_public_key: prfKeySet.encryptedPublicKey,
					encrypted_private_key: prfKeySet.encryptedPrivateKey,
					supports_prf: 1,
					updated_at: ts,
				})
				.where("user_id", "=", user.id)
				.where("credential_id", "=", assertion.credential.credential_id)
				.compile(),
			webauthnCredentialRevisionQuery(db, user.id, assertion.credential.id, ts),
		]);
		if (updated.numAffectedRows !== 1n)
			return errorResponse("Passkey not found", 404);

		await safeWriteAuditEvent(db, {
			actorUserId: user.id,
			action: "account.passkey.encryption.enable",
			category: "system",
			level: "info",
			targetType: "accountPasskey",
			targetId: assertion.credential.id,
			metadata: auditRequestMetadata(c.req.raw),
		});

		return jsonResponse({ success: true });
	},
);

// POST /api/webauthn/:id/delete
export const deleteAccountPasskey = factory.createHandlers(
	vValidator("json", PasskeySecretSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const id = c.get("accountPasskey").id;
		const body = c.req.valid("json");

		if (!(await verifyUserSecret(user, body))) {
			return errorResponse("Master password verification failed", 400);
		}

		const securityStamp = crypto.randomUUID();
		const [claimed, deleted] = await c
			.get("dbDialect")
			.batch([
				conditionalWebauthnCredentialDeletionClaimQuery(
					db,
					user.id,
					id,
					"login",
					user.security_stamp,
					securityStamp,
				),
				conditionalWebauthnCredentialDeletionQuery(
					db,
					user.id,
					id,
					"login",
					securityStamp,
				),
				conditionalRefreshTokenDeletionQuery(db, user.id, securityStamp),
				conditionalUserRevisionQuery(db, user.id, securityStamp),
			]);
		if (claimed.numAffectedRows !== 1n)
			return errorResponse("Passkey settings changed by another request", 409);
		if (deleted.numAffectedRows !== 1n)
			return errorResponse("Passkey deletion could not be persisted", 500);
		invalidateUserCache(user.id);

		await safeWriteAuditEvent(db, {
			actorUserId: user.id,
			action: "account.passkey.delete",
			category: "system",
			level: "info",
			targetType: "accountPasskey",
			targetId: id,
			metadata: auditRequestMetadata(c.req.raw),
		});

		return jsonResponse({ success: true });
	},
);

export function buildAccountPasskeyTokenUserDecryptionOption(
	credential: Selectable<WebauthnCredentials>,
) {
	return buildWebAuthnPrfOption(credential);
}
