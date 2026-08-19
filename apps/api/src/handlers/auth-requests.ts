import { vValidator } from "@hono/valibot-validator";
import type { Selectable } from "kysely";
import { factory } from "../http/factory";
import {
  AuthRequestCreateSchema,
  AuthRequestUpdateSchema,
} from "../schemas/requests";
import * as authRequestsDb from "../services/db/auth-requests";
import * as devicesDb from "../services/db/devices";
import * as usersDb from "../services/db/users";
import {
  constantTimeCredentialEqual,
  hashCredential,
} from "../services/credential-protection";
import type { AuthRequests } from "../types/db";
import { errorResponse } from "../utils/response";
import { toIso } from "../utils/time";

const DEVICE_TYPE_NAMES = [
  "Android",
  "iOS",
  "Chrome Extension",
  "Firefox Extension",
  "Opera Extension",
  "Edge Extension",
  "Windows",
  "macOS",
  "Linux",
  "Chrome",
  "Firefox",
  "Opera",
  "Edge",
  "Internet Explorer",
  "Unknown Browser",
  "Android",
  "UWP",
  "Safari",
  "Vivaldi",
  "Vivaldi Extension",
  "Safari Extension",
  "SDK",
  "Server",
  "Windows CLI",
  "MacOs CLI",
  "Linux CLI",
  "DuckDuckGo",
] as const;

function authRequestToResponse(
  authRequest: Selectable<AuthRequests>,
  origin: string,
) {
  return {
    id: authRequest.id,
    requestDeviceIdentifier: authRequest.request_device_identifier,
    requestDeviceTypeValue: authRequest.request_device_type,
    requestDeviceType:
      DEVICE_TYPE_NAMES[authRequest.request_device_type] ?? "Unknown Browser",
    requestIpAddress: authRequest.request_ip_address ?? null,
    requestCountryName: authRequest.request_country_name ?? null,
    publicKey: authRequest.public_key,
    key: authRequest.key ?? null,
    masterPasswordHash: authRequest.master_password_hash ?? null,
    requestApproved: authRequest.approved === 1,
    origin,
    creationDate: toIso(authRequest.creation_date),
    responseDate: authRequest.response_date
      ? toIso(authRequest.response_date)
      : null,
    object: "auth-request",
  };
}

export const createAuthRequest = factory.createHandlers(
  vValidator("json", AuthRequestCreateSchema),
  async (c) => {
    const db = c.get("db");
    const body = c.req.valid("json");
    if (body.type === 2)
      return errorResponse("Admin approval requires authentication", 400);
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
      publicKey: body.publicKey,
    });
    const authRequest = await authRequestsDb.getAuthRequestById(db, id);
    if (!authRequest)
      return errorResponse("Failed to create auth request", 500);
    return c.json(authRequestToResponse(authRequest, new URL(c.req.url).host));
  },
);

export const getAuthRequest = factory.createHandlers(async (c) =>
  c.json(authRequestToResponse(c.get("authRequest"), new URL(c.req.url).host)),
);

export const getAuthRequestResponse = factory.createHandlers(async (c) => {
  const id = c.req.param("id");
  const code = c.req.query("code") ?? "";
  if (!id || !code) return errorResponse("Not found", 404);
  const request = await authRequestsDb.getAuthRequestById(c.get("db"), id);
  if (
    !request ||
    authRequestsDb.isAuthRequestExpired(request) ||
    !constantTimeCredentialEqual(
      request.access_code_hash,
      await hashCredential(code),
    )
  )
    return errorResponse("Not found", 404);
  return c.json(authRequestToResponse(request, new URL(c.req.url).host));
});

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
      body.deviceIdentifier,
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
    return c.json(authRequestToResponse(updated, new URL(c.req.url).host));
  },
);

export const listAuthRequests = factory.createHandlers(async (c) => {
  const requests = await authRequestsDb.getAuthRequestsByUserId(
    c.get("db"),
    c.get("user").id,
  );
  return c.json({
    data: requests.map((request) =>
      authRequestToResponse(request, new URL(c.req.url).host),
    ),
    object: "list",
    continuationToken: null,
  });
});

export const listPendingAuthRequests = factory.createHandlers(async (c) => {
  const db = c.get("db");
  const userId = c.get("user").id;
  const [requests, devices] = await Promise.all([
    authRequestsDb.getPendingAuthRequestsByUserId(db, userId),
    devicesDb.getDevicesByUserId(db, userId),
  ]);
  const deviceIds = new Map(
    devices.map((device) => [device.device_identifier, device.id]),
  );
  return c.json({
    data: requests.map((request) => ({
      ...authRequestToResponse(request, new URL(c.req.url).host),
      requestDeviceId: deviceIds.get(request.request_device_identifier) ?? null,
    })),
    object: "list",
    continuationToken: null,
  });
});
