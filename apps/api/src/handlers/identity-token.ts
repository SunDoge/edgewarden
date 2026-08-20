import { getCookie } from "hono/cookie";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { checkIpRateLimit } from "../middleware/rate-limit";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import { authenticateApiKey } from "../services/identity-api-key";
import { refreshIdentitySession } from "../services/identity-refresh";
import { issueIdentitySession } from "../services/identity-session";
import * as sendsDb from "../services/db/sends";
import { getSafeSendJwtSecret } from "../services/sends/jwt-secret";
import { verifySendPassword } from "../services/sends/password";
import { fromAccessId, isSendAvailable } from "../services/sends/presentation";
import {
  getPushRelayStatus,
  logPushRelayFailure,
  pushDeviceRegistrationFromDatabase,
} from "../services/push-relay";
import { identityErrorResponse, jsonResponse } from "../utils/response";
import { createSendAccessToken } from "../utils/jwt";
import {
  assertAccountPasskeyCredential,
  buildAccountPasskeyTokenUserDecryptionOption,
} from "./account-passkeys";
import { handlePasswordGrant } from "./identity-password-grant";
import {
  buildTokenResponse,
  isWebClient,
  readDeviceInfo,
  setWebRefreshCookie,
  webRefreshCookieName,
} from "./identity-token-helpers";

function sendAccessError(
  message: string,
  error: string,
  errorType: string,
): Response {
  return jsonResponse(
    {
      error,
      error_description: message,
      send_access_error_type: errorType,
      ErrorModel: { Message: message, Object: "error" },
    },
    400,
  );
}

// POST /identity/connect/token
export const connectToken = factory.createHandlers(async (c) => {
  const db = c.get("db");
  const secret = c.env.JWT_SECRET;

  if (!(await checkIpRateLimit(c, "identity"))) {
    return identityErrorResponse(
      "Too many requests. Try again later.",
      "TooManyRequests",
      429,
    );
  }

  const body = c.get("tokenRequest");
  const grantType = body.grant_type;
  if (grantType === "send_access") {
    const sendId = fromAccessId(body.send_id ?? "");
    const send = sendId ? await sendsDb.getSendById(db, sendId) : null;
    if (!send || !isSendAvailable(send)) {
      return sendAccessError(
        "send_id is invalid.",
        "invalid_grant",
        "send_id_invalid",
      );
    }
    if (send.auth_type === 0) {
      return sendAccessError(
        body.email ? "email and otp are required." : "email is required.",
        "invalid_request",
        body.email ? "email_and_otp_required" : "email_required",
      );
    }
    if (send.password_hash) {
      if (!body.password_hash_b64) {
        return sendAccessError(
          "password_hash_b64 is required.",
          "invalid_request",
          "password_hash_b64_required",
        );
      }
      if (!(await verifySendPassword(send, body.password_hash_b64))) {
        return sendAccessError(
          "password_hash_b64 is invalid.",
          "invalid_grant",
          "password_hash_b64_invalid",
        );
      }
    }
    const sendSecret = getSafeSendJwtSecret(c.env);
    if (!sendSecret)
      return identityErrorResponse(
        "Server configuration error",
        "server_error",
        500,
      );
    return c.json({
      access_token: await createSendAccessToken(send.id, sendSecret),
      expires_in: LIMITS.auth.sendAccessTokenTtlSeconds,
      token_type: "Bearer",
      scope: "api.send.access",
    });
  }
  if (grantType === "password") return handlePasswordGrant(c);

  if (grantType === "webauthn") {
    const token = String(body.token || "").trim();
    let deviceResponse: unknown = body.deviceResponse;
    if (typeof deviceResponse === "string") {
      deviceResponse = safeParseJsonWithSchema(
        deviceResponse,
        v.record(v.string(), v.unknown()),
      );
      if (!deviceResponse) {
        return identityErrorResponse(
          "Invalid passkey response",
          "invalid_request",
          400,
        );
      }
    }
    if (!token || !deviceResponse) {
      return identityErrorResponse(
        "Passkey token and deviceResponse are required",
        "invalid_request",
        400,
      );
    }

    let asserted: Awaited<ReturnType<typeof assertAccountPasskeyCredential>>;
    try {
      asserted = await assertAccountPasskeyCredential(
        c.req.raw,
        c.env,
        db,
        c.get("dbDialect"),
        {
          token,
          deviceResponse,
          scope: "Authentication",
        },
      );
    } catch (error: unknown) {
      await safeWriteAuditEvent(db, {
        actorUserId: null,
        action: "auth.passkey.login.failed",
        category: "auth",
        level: "warning",
        targetType: "accountPasskey",
        targetId: null,
        metadata: {
          grantType,
          reason:
            error instanceof Error && error.message
              ? error.message
              : "assertion_failed",
          ...auditRequestMetadata(c.req.raw),
        },
      });
      return identityErrorResponse(
        "Passkey is invalid. Try again",
        "invalid_grant",
        400,
      );
    }

    const { user, credential } = asserted;
    if (user.status !== "active") {
      return identityErrorResponse("Account is disabled", "invalid_grant", 400);
    }

    const deviceInfo = readDeviceInfo(body);
    if (!getPushRelayStatus(c.env).enabled) deviceInfo.pushToken = null;
    const session = await issueIdentitySession({
      db,
      dialect: c.get("dbDialect"),
      user,
      device: deviceInfo,
      jwtSecret: secret,
    });
    if (!session)
      return identityErrorResponse(
        "Unable to create session",
        "server_error",
        500,
      );
    const { accessToken, refreshToken, deviceSession } = session;
    const webAuthnPrfOption =
      buildAccountPasskeyTokenUserDecryptionOption(credential);
    if (deviceInfo.pushToken && deviceSession) {
      c.executionCtx.waitUntil(
        pushDeviceRegistrationFromDatabase(
          c.env,
          user.id,
          deviceSession.identifier,
        ).catch((error) =>
          logPushRelayFailure("push.device.login-register.failed", error),
        ),
      );
    }

    await safeWriteAuditEvent(db, {
      actorUserId: user.id,
      action: "auth.passkey.login.success",
      category: "auth",
      level: "info",
      targetType: "accountPasskey",
      targetId: credential.id,
      metadata: {
        grantType,
        deviceIdentifier: deviceSession?.identifier ?? deviceInfo.identifier,
        deviceType: deviceInfo.type,
        ...auditRequestMetadata(c.req.raw),
      },
    });

    if (isWebClient(body)) setWebRefreshCookie(c, refreshToken);
    return c.json(
      buildTokenResponse(
        accessToken,
        refreshToken,
        user,
        undefined,
        webAuthnPrfOption,
        !isWebClient(body),
      ),
    );
  }

  if (grantType === "refresh_token") {
    const webClient = isWebClient(body);
    const rawToken =
      body.refresh_token ||
      (webClient ? getCookie(c, webRefreshCookieName(c.req.url)) : undefined);
    if (!rawToken) {
      return identityErrorResponse(
        "Refresh token is required",
        "invalid_grant",
        400,
      );
    }

    const refreshed = await refreshIdentitySession({
      db,
      dialect: c.get("dbDialect"),
      rawToken,
      jwtSecret: secret,
    });
    if (!refreshed.ok) {
      const message =
        refreshed.reason === "invalid_refresh_token"
          ? "Refresh token is invalid or expired"
          : refreshed.reason === "inactive_account"
            ? "Account not found or inactive"
            : "Device session is invalid";
      return identityErrorResponse(message, "invalid_grant", 400);
    }

    if (webClient) setWebRefreshCookie(c, refreshed.refreshToken);
    return c.json(
      buildTokenResponse(
        refreshed.accessToken,
        refreshed.refreshToken,
        refreshed.user,
        undefined,
        null,
        !webClient,
      ),
    );
  }

  if (grantType === "client_credentials") {
    const authenticated = await authenticateApiKey({
      db,
      clientId: body.client_id ?? "",
      clientSecret: body.client_secret ?? "",
      jwtSecret: secret,
    });
    if (!authenticated.ok && authenticated.reason === "invalid_client_id") {
      return identityErrorResponse(
        "Invalid client_id format",
        "invalid_request",
        400,
      );
    }
    if (!authenticated.ok) {
      return identityErrorResponse(
        "Invalid client credentials",
        "invalid_client",
        400,
      );
    }
    return c.json({
      access_token: authenticated.accessToken,
      expires_in: LIMITS.auth.accessTokenTtlSeconds,
      token_type: "Bearer",
      scope: "api",
    });
  }

  return identityErrorResponse(
    "Unsupported grant_type",
    "unsupported_grant_type",
    400,
  );
});
import { safeParseJsonWithSchema } from "@edgewarden/shared";
import * as v from "valibot";
