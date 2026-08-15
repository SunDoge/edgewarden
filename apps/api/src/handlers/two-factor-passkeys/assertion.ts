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

import { challengeHash } from "./shared";

// A successful assertion atomically consumes its challenge and advances the credential counter to prevent replay.
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
	dialect: D1Dialect,
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
	if (!response) throw new Error("Invalid two-factor passkey response");
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
	if (
		!(await webauthnDb.claimVerifiedPasskeyAssertion(db, dialect, {
			challengeHash: await challengeHash(payload.challenge),
			scope: "action",
			challengeUserId: userId,
			credentialUserId: userId,
			credentialId: credential.credential_id,
			expectedCounter: credential.counter,
			newCounter: verification.authenticationInfo.newCounter,
		}))
	)
		throw new Error("Two-factor passkey assertion was already used");
}
