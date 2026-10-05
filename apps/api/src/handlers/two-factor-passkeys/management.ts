import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { sql } from "kysely";
import { factory } from "../../http/factory";
import type { HonoEnv } from "../../env";
import {
  TwoFactorPasskeyChallengeSchema,
  TwoFactorPasskeyDeleteAllSchema,
  TwoFactorPasskeyDeleteSchema,
  TwoFactorPasskeyRegistrationSchema,
} from "../../schemas/passkeys";
import { SecretVerificationSchema } from "../../schemas/two-factor";
import {
  auditEventInsertQuery,
  auditRequestMetadata,
} from "../../services/audit";
import { invalidateUserCache } from "../../services/auth";
import { encryptCredential } from "../../services/credential-protection";
import {
  webAuthnDetails,
  webAuthnMutationResponse,
  webAuthnReadResponse,
} from "../../services/two-factor-presentation";
import {
  conditionalRefreshTokenDeletionQuery,
  conditionalTwoFactorCredentialDeletionQuery,
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
  normalizeRegistrationResponse,
  normalizeTransports,
  userIdToWebAuthnUserId,
  verifyAccountPasskeyToken,
} from "../../utils/account-passkeys";
import {
  createTwoFactorProviderToken,
  verifyTwoFactorProviderToken,
} from "../../utils/jwt";
import { bytesToBase64Url } from "../../utils/passkey";
import { errorResponse, jsonResponse } from "../../utils/response";
import { now } from "../../utils/time";

import {
  challengeHash,
  MAX_TWO_FACTOR_PASSKEYS,
  recoveryCode,
  verifySecret,
} from "./shared";

const WEBAUTHN_PROVIDER = 7;

async function hasValidUserVerificationToken(
  c: Context<HonoEnv>,
  token: string,
): Promise<boolean> {
  const claims = await verifyTwoFactorProviderToken(token, c.env.JWT_SECRET);
  const user = c.get("user");
  return Boolean(
    claims &&
      claims.sub === user.id &&
      claims.provider === WEBAUTHN_PROVIDER &&
      claims.sstamp === user.security_stamp,
  );
}

// Registration and deletion bind credential changes, recovery material, revision writes, and audit records in guarded D1 batches.
export const getTwoFactorPasskeys = factory.createHandlers(
  vValidator("json", SecretVerificationSchema),
  async (c) => {
    if (!(await verifySecret(c.get("user"), c.req.valid("json"))))
      return errorResponse("Master password verification failed", 400);
    const user = c.get("user");
    return jsonResponse(
      webAuthnReadResponse(
        webAuthnDetails(
          await webauthnDb.listAccountPasskeyCredentialsByUserId(
            c.get("db"),
            user.id,
            "twoFactor",
          ),
        ),
        await createTwoFactorProviderToken(
          user.id,
          WEBAUTHN_PROVIDER,
          user.security_stamp,
          c.env.JWT_SECRET,
        ),
      ),
    );
  },
);

export const getTwoFactorPasskeyChallenge = factory.createHandlers(
  vValidator("json", TwoFactorPasskeyChallengeSchema),
  async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    if (
      !(await hasValidUserVerificationToken(
        c,
        c.req.valid("json").userVerificationToken,
      ))
    )
      return errorResponse("User verification failed.", 400);
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
      userID: userIdToWebAuthnUserId(user.id),
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
    if (!(await hasValidUserVerificationToken(c, body.userVerificationToken)))
      return errorResponse("User verification failed.", 400);
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
    if (
      await webauthnDb.getTwoFactorCredentialByProviderKeyId(
        db,
        user.id,
        body.id,
      )
    )
      return errorResponse("Two-factor passkey key ID is already in use", 409);
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
      provider_key_id: body.id,
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
      webAuthnMutationResponse(
        webAuthnDetails(
          await webauthnDb.listAccountPasskeyCredentialsByUserId(
            db,
            user.id,
            "twoFactor",
          ),
        ),
        "update",
      ),
    );
  },
);

export const deleteTwoFactorPasskey = factory.createHandlers(
  vValidator("json", TwoFactorPasskeyDeleteSchema),
  async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    if (!(await hasValidUserVerificationToken(c, body.userVerificationToken)))
      return errorResponse("User verification failed.", 400);
    const db = c.get("db");
    const existing = await webauthnDb.getTwoFactorCredentialByProviderKeyId(
      db,
      user.id,
      body.id,
    );
    if (!existing) return errorResponse("Two-factor passkey not found", 404);
    if (
      (await webauthnDb.countAccountPasskeyCredentialsByUserId(
        db,
        user.id,
        "twoFactor",
      )) <= 1
    )
      return errorResponse(
        "Use the delete-all endpoint to remove the final two-factor passkey",
        400,
      );
    const ts = now();
    const securityStamp = crypto.randomUUID();
    const [claimed, deleted] = await c.get("dbDialect").batch([
      conditionalWebauthnCredentialDeletionClaimQuery(
        db,
        user.id,
        existing.id,
        "twoFactor",
        user.security_stamp,
        securityStamp,
        ts,
      ),
      conditionalWebauthnCredentialDeletionQuery(
        db,
        user.id,
        existing.id,
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
          targetId: existing.id,
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
      webAuthnMutationResponse(
        webAuthnDetails(
          await webauthnDb.listAccountPasskeyCredentialsByUserId(
            db,
            user.id,
            "twoFactor",
          ),
        ),
        "delete",
      ),
    );
  },
);

export const deleteAllTwoFactorPasskeys = factory.createHandlers(
  vValidator("json", TwoFactorPasskeyDeleteAllSchema),
  async (c) => {
    const user = c.get("user");
    if (
      !(await hasValidUserVerificationToken(
        c,
        c.req.valid("json").userVerificationToken,
      ))
    )
      return errorResponse("User verification failed.", 400);
    const db = c.get("db");
    const ts = now();
    const securityStamp = crypto.randomUUID();
    const [claimed] = await c.get("dbDialect").batch([
      db
        .updateTable("users")
        .set({ security_stamp: securityStamp, updated_at: ts })
        .where("id", "=", user.id)
        .where("security_stamp", "=", user.security_stamp),
      conditionalTwoFactorCredentialDeletionQuery(db, user.id, securityStamp),
      conditionalRefreshTokenDeletionQuery(db, user.id, securityStamp),
      conditionalUserRevisionQuery(db, user.id, securityStamp, ts),
      auditEventInsertQuery(
        db,
        {
          actorUserId: user.id,
          action: "account.two_factor.passkey.delete_all",
          category: "auth",
          targetType: "user",
          targetId: user.id,
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
    invalidateUserCache(user.id);
    return new Response(null, { status: 204 });
  },
);
