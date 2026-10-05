import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import { checkIpRateLimit } from "../middleware/rate-limit";
import {
  AuthRequestCreateSchema,
  AuthRequestResponseQuerySchema,
  AuthRequestUpdateSchema,
} from "../schemas/requests";
import * as authRequestsDb from "../services/db/auth-requests";
import * as devicesDb from "../services/db/devices";
import * as usersDb from "../services/db/users";
import {
  constantTimeCredentialEqual,
  hashCredential,
} from "../services/credential-protection";
import { parseDeviceTypeHeader } from "../services/auth-requests/device-type";
import { authRequestToResponse } from "../services/auth-requests/presentation";
import {
  logPushRelayFailure,
  publishPushAuthRequest,
} from "../services/push-relay";
import { publishAuthRequestNotification } from "../services/realtime";
import { errorResponse } from "../utils/response";

export const createAuthRequest = factory.createHandlers(
  vValidator("json", AuthRequestCreateSchema),
  async (c) => {
    // Rate-limit only creation. The requester polls every few seconds while it
    // waits, so applying the shared IP quota to reads would break valid logins.
    if (!(await checkIpRateLimit(c, "auth-request"))) {
      return errorResponse("Too many auth requests. Try again later.", 429);
    }
    const db = c.get("db");
    const body = c.req.valid("json");
    const deviceTypeHeader = c.req.header("Device-Type");
    const headerDeviceType = parseDeviceTypeHeader(deviceTypeHeader);
    if (deviceTypeHeader !== undefined && headerDeviceType === null) {
      return errorResponse("Invalid device type", 400);
    }
    const requestDeviceType = headerDeviceType ?? body.deviceType;
    if (requestDeviceType === undefined) {
      return errorResponse("Device type not provided", 400);
    }
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
      requestDeviceType,
      requestIpAddress: c.req.header("CF-Connecting-IP") ?? null,
      accessCodeHash: await hashCredential(body.accessCode),
      publicKey: body.publicKey,
    });
    const authRequest = await authRequestsDb.getAuthRequestById(db, id);
    if (!authRequest)
      return errorResponse("Failed to create auth request", 500);
    c.executionCtx.waitUntil(
      Promise.all([
        publishPushAuthRequest(c.env, user.id, id, body.deviceIdentifier).catch(
          (error) => logPushRelayFailure("push.auth-request.failed", error),
        ),
        publishAuthRequestNotification(
          c.env,
          user.id,
          id,
          body.deviceIdentifier,
        ).catch((error) =>
          logPushRelayFailure("realtime.auth-request.failed", error),
        ),
      ]).then(() => undefined),
    );
    return c.json(authRequestToResponse(authRequest, new URL(c.req.url).host));
  },
);

export const getAuthRequest = factory.createHandlers(async (c) =>
  c.json(authRequestToResponse(c.get("authRequest"), new URL(c.req.url).host)),
);

export const getAuthRequestResponse = factory.createHandlers(
  vValidator("query", AuthRequestResponseQuerySchema),
  async (c) => {
    const id = c.req.param("id");
    const { code } = c.req.valid("query");
    if (!id) return errorResponse("Not found", 404);
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
  },
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
    const responseDevice = await devicesDb.getDevice(
      db,
      c.get("user").id,
      body.deviceIdentifier,
    );
    if (!responseDevice) return errorResponse("Invalid device", 400);
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
