import { vValidator } from "@hono/valibot-validator";
import type { Selectable } from "kysely";
import { factory } from "../http/factory";
import {
  AuthRequestCreateSchema,
  AuthRequestUpdateSchema,
} from "../schemas/requests";
import * as authRequestsDb from "../services/db/auth-requests";
import * as usersDb from "../services/db/users";
import {
  decryptCredential,
  encryptCredential,
  hashCredential,
} from "../services/credential-protection";
import type { AuthRequests } from "../types/db";
import { errorResponse } from "../utils/response";
import { toIso } from "../utils/time";

async function authRequestToResponse(
  authRequest: Selectable<AuthRequests>,
  dataEncryptionSecret: string,
) {
  return {
    id: authRequest.id,
    userId: authRequest.user_id,
    type: authRequest.type,
    requestDeviceIdentifier: authRequest.request_device_identifier,
    requestDeviceType: authRequest.request_device_type,
    requestIpAddress: authRequest.request_ip_address ?? null,
    requestCountryName: authRequest.request_country_name ?? null,
    responseDeviceIdentifier: authRequest.response_device_identifier ?? null,
    accessCode: await decryptCredential(
      authRequest.access_code_encrypted,
      dataEncryptionSecret,
      "auth-request-access-code",
    ),
    publicKey: authRequest.public_key,
    key: authRequest.key ?? null,
    masterPasswordHash: authRequest.master_password_hash ?? null,
    approved:
      authRequest.approved === 1
        ? true
        : authRequest.approved === 0
          ? false
          : null,
    creationDate: toIso(authRequest.creation_date),
    responseDate: authRequest.response_date
      ? toIso(authRequest.response_date)
      : null,
    authenticationDate: authRequest.authentication_date
      ? toIso(authRequest.authentication_date)
      : null,
    isExpired: authRequestsDb.isAuthRequestExpired(authRequest),
    object: "auth-request",
  };
}

export const createAuthRequest = factory.createHandlers(
  vValidator("json", AuthRequestCreateSchema),
  async (c) => {
    const db = c.get("db");
    const body = c.req.valid("json");
    const user = await usersDb.getUserByEmail(db, body.email);
    if (!user) return errorResponse("User not found", 404);

    const id = crypto.randomUUID();
    await authRequestsDb.createAuthRequest(db, {
      id,
      userId: user.id,
      type: body.type ?? 0,
      requestDeviceIdentifier: body.deviceIdentifier,
      requestDeviceType: body.deviceType,
      requestIpAddress: c.req.header("CF-Connecting-IP") ?? null,
      accessCodeHash: await hashCredential(body.accessCode),
      accessCodeEncrypted: await encryptCredential(
        body.accessCode,
        c.env.DATA_ENCRYPTION_SECRET,
        "auth-request-access-code",
      ),
      publicKey: body.publicKey,
    });
    const authRequest = await authRequestsDb.getAuthRequestById(db, id);
    if (!authRequest)
      return errorResponse("Failed to create auth request", 500);
    return c.json(
      await authRequestToResponse(authRequest, c.env.DATA_ENCRYPTION_SECRET),
      200,
    );
  },
);

export const getAuthRequest = factory.createHandlers(async (c) =>
  c.json(
    await authRequestToResponse(
      c.get("authRequest"),
      c.env.DATA_ENCRYPTION_SECRET,
    ),
  ),
);

export const updateAuthRequest = factory.createHandlers(
  vValidator("json", AuthRequestUpdateSchema),
  async (c) => {
    const db = c.get("db");
    const authRequest = c.get("authRequest");
    if (authRequestsDb.isAuthRequestExpired(authRequest)) {
      return errorResponse("Auth request has expired", 400);
    }
    const body = c.req.valid("json");
    const decided = await authRequestsDb.approveAuthRequest(
      db,
      authRequest.id,
      body.approved,
      c.get("payload").did ?? "",
      body.approved ? body.key : null,
      body.approved ? body.masterPasswordHash : null,
    );
    if (!decided)
      return errorResponse(
        "Auth request was already decided, consumed, or expired",
        409,
      );
    const updated = await authRequestsDb.getAuthRequestById(db, authRequest.id);
    if (!updated) return errorResponse("Failed to update auth request", 500);
    return c.json(
      await authRequestToResponse(updated, c.env.DATA_ENCRYPTION_SECRET),
    );
  },
);

export const listAuthRequests = factory.createHandlers(async (c) => {
  const pending = await authRequestsDb.getPendingAuthRequestsForDevice(
    c.get("db"),
    c.get("user").id,
    c.get("payload").did ?? "",
  );
  return c.json({
    data: await Promise.all(
      pending.map((request) =>
        authRequestToResponse(request, c.env.DATA_ENCRYPTION_SECRET),
      ),
    ),
    object: "list",
    continuationToken: null,
  });
});
