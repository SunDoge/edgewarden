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

// Credential claims, encrypted PRF material, security-stamp rotation, and revision updates are committed as one guarded D1 batch.
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

    const ts = now();
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
      mutation_token: crypto.randomUUID(),
      created_at: ts,
      updated_at: ts,
    };

    const securityStamp = crypto.randomUUID();
    const [claimed, inserted, consumed] = await c.get("dbDialect").batch([
      conditionalAccountPasskeyClaimQuery(
        db,
        user.id,
        user.security_stamp,
        credential.credential_id,
        securityStamp,
        MAX_ACCOUNT_PASSKEYS,
        ts,
        { hash: challengeHash, scope: "register" },
      ),
      conditionalWebauthnCredentialInsertQuery(db, credential, securityStamp),
      conditionalWebauthnChallengeConsumptionQuery(db, {
        challengeHash,
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
          action: "account.passkey.create",
          category: "system",
          level: "info",
          targetType: "accountPasskey",
          targetId: credential.id,
          metadata: {
            prfStatus: accountPasskeyPrfStatus(credential),
            ...auditRequestMetadata(c.req.raw),
          },
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
      assertion = await assertAccountPasskeyCredential(
        c.req.raw,
        c.env,
        db,
        c.get("dbDialect"),
        {
          token: String(body.token || ""),
          deviceResponse: body.deviceResponse,
          scope: "UpdateKeySet",
          expectedUserId: user.id,
        },
      );
    } catch (error: unknown) {
      return errorResponse(
        error instanceof Error && error.message
          ? error.message
          : "Passkey assertion failed",
        400,
      );
    }

    const ts = now();
    const mutationToken = crypto.randomUUID();
    const [updated] = await c.get("dbDialect").batch([
      conditionalWebauthnEncryptionUpdateQuery(
        db,
        assertion.credential,
        prfKeySet.encryptedUserKey,
        prfKeySet.encryptedPublicKey,
        prfKeySet.encryptedPrivateKey,
        mutationToken,
        ts,
      ),
      conditionalWebauthnEncryptionRevisionQuery(
        db,
        user.id,
        assertion.credential.id,
        mutationToken,
        ts,
      ),
      auditEventInsertQuery(
        db,
        {
          actorUserId: user.id,
          action: "account.passkey.encryption.enable",
          category: "system",
          level: "info",
          targetType: "accountPasskey",
          targetId: assertion.credential.id,
          metadata: auditRequestMetadata(c.req.raw),
        },
        sql<boolean>`EXISTS (
						SELECT 1 FROM webauthn_credentials
						WHERE id = ${assertion.credential.id}
						  AND mutation_token = ${mutationToken}
					)`,
        ts,
      ),
    ]);
    if (updated.numAffectedRows !== 1n)
      return errorResponse(
        "Passkey encryption changed by another request",
        409,
      );

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
    const [claimed, deleted] = await c.get("dbDialect").batch([
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
      auditEventInsertQuery(
        db,
        {
          actorUserId: user.id,
          action: "account.passkey.delete",
          category: "system",
          level: "info",
          targetType: "accountPasskey",
          targetId: id,
          metadata: auditRequestMetadata(c.req.raw),
        },
        sql<boolean>`EXISTS (
						SELECT 1 FROM users
						WHERE id = ${user.id} AND security_stamp = ${securityStamp}
					)`,
      ),
    ]);
    if (claimed.numAffectedRows !== 1n)
      return errorResponse("Passkey settings changed by another request", 409);
    if (deleted.numAffectedRows !== 1n)
      return errorResponse("Passkey deletion could not be persisted", 500);
    invalidateUserCache(user.id);

    return jsonResponse({ success: true });
  },
);

export function buildAccountPasskeyTokenUserDecryptionOption(
  credential: Selectable<WebauthnCredentials>,
) {
  return buildWebAuthnPrfOption(credential);
}
