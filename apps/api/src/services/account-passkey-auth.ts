import {
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import {
	createAccountPasskeyToken,
	getAccountPasskeyRpConfig,
	normalizeAuthenticationResponse,
	toSimpleWebAuthnCredential,
	userHandleToUserId,
	verifyAccountPasskeyToken,
} from "../utils/account-passkeys";
import { bytesToBase64Url } from "../utils/passkey";
import { jsonResponse } from "../utils/response";
import { now } from "../utils/time";
import * as usersDb from "./db/users";
import * as webauthnDb from "./db/webauthn";
import { verifyPassword } from "./auth";

export async function verifyUserSecret(
	user: any,
	body: Record<string, any>,
): Promise<boolean> {
	const secret = String(
		body.masterPasswordHash ||
			body.master_password_hash ||
			body.secret ||
			body.password ||
			"",
	).trim();
	if (!secret) return false;
	const storedHash = String(user.master_password_hash || "").trim();
	if (!storedHash) return false;
	return verifyPassword(secret, storedHash, user.email);
}

// Public endpoint handler helper
export async function handleGetAccountPasskeyAssertionOptions(
	c: any,
): Promise<Response> {
	const db = c.get("db");
	const { rpId } = getAccountPasskeyRpConfig(c.req.raw, c.env);
	const options = await generateAuthenticationOptions({
		rpID: rpId,
		allowCredentials: [],
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
		scope: "login", // 'login' maps to 'Authentication'
		user_id: null,
		expires_at: ts + 17 * 60,
		used_at: null,
		created_at: ts,
	});

	const token = await createAccountPasskeyToken(c.env.JWT_SECRET, {
		scope: "Authentication",
		challenge: options.challenge,
		userId: null,
		rpId,
		purpose: "login",
	});

	return jsonResponse({
		options,
		token,
		object: "webAuthnLoginAssertionOptions",
		Object: "webAuthnLoginAssertionOptions",
	});
}

// Core assertion checker used during login
export async function assertAccountPasskeyCredential(
	request: Request,
	env: CloudflareBindings,
	db: any,
	input: {
		token: string;
		deviceResponse: unknown;
		scope: "Authentication" | "UpdateKeySet";
		expectedUserId?: string | null;
	},
): Promise<{ user: any; credential: any }> {
	const payload = await verifyAccountPasskeyToken(
		env.JWT_SECRET,
		input.token,
		input.scope,
		"login",
	);
	if (!payload) {
		throw new Error("Passkey challenge token is invalid or expired");
	}
	if (
		input.expectedUserId !== undefined &&
		payload.userId !== input.expectedUserId
	) {
		throw new Error("Passkey challenge token does not match this user");
	}

	const response = normalizeAuthenticationResponse(input.deviceResponse);
	if (!response) {
		throw new Error("Invalid passkey assertion response");
	}

	const challengeBytes = new TextEncoder().encode(payload.challenge);
	const challengeHashBuf = await crypto.subtle.digest(
		"SHA-256",
		challengeBytes,
	);
	const challengeHash = bytesToBase64Url(new Uint8Array(challengeHashBuf));

	const scopeDb = input.scope === "Authentication" ? "login" : "action";
	const consumed = await webauthnDb.consumeAccountPasskeyChallenge(
		db,
		challengeHash,
		scopeDb,
		payload.userId,
	);
	if (!consumed) {
		throw new Error("Passkey challenge has expired or was already used");
	}

	const credential = await webauthnDb.getAccountPasskeyCredentialByCredentialId(
		db,
		response.rawId,
	);
	if (!credential) {
		throw new Error("Passkey is not registered for this server");
	}
	if (payload.userId && credential.user_id !== payload.userId) {
		throw new Error("Passkey does not belong to this user");
	}

	const userHandleUserId = userHandleToUserId(response.response.userHandle);
	const resolvedUserId =
		payload.userId || userHandleUserId || credential.user_id;
	if (!resolvedUserId || resolvedUserId !== credential.user_id) {
		throw new Error("Passkey user handle does not match this credential");
	}

	const user = await usersDb.getUserById(db, resolvedUserId);
	if (!user || user.status !== "active") {
		throw new Error("Passkey user is not available");
	}

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

	if (!verification.verified || !verification.authenticationInfo.userVerified) {
		throw new Error("Passkey assertion could not be verified");
	}

	await webauthnDb.updateAccountPasskeyCounter(
		db,
		credential.user_id,
		credential.credential_id,
		verification.authenticationInfo.newCounter,
	);
	credential.counter = verification.authenticationInfo.newCounter;

	return { user, credential };
}

// GET /api/webauthn
