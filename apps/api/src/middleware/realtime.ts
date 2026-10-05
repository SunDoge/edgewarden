import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env";
import { getAuthRequestById } from "../services/db/auth-requests";
import { getRevisionValue } from "../services/db/revisions";
import {
  logPushRelayFailure,
  publishPushAuthRequestResponse,
  publishPushVaultChange,
} from "../services/push-relay";
import { publishMutationVaultChange } from "../services/realtime";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SYNC_STATE_PATH =
  /^\/api\/(?:accounts(?:$|\/(?:profile|keys|password))|ciphers(?:\/|$)|folders(?:\/|$)|sends(?:\/|$)|settings\/domains(?:\/|$)|organizations(?:\/|$)|two-factor(?:\/|$)|webauthn(?:\/|$)|yubico-enrollment(?:\/|$))/;
const AUTH_REQUEST_PATH = /^\/api\/auth-requests(?:\/|$)/;

export const realtimeMutationMiddleware = createMiddleware<HonoEnv>(
  async (c, next) => {
    const mutating = MUTATING_METHODS.has(c.req.method);
    const tracksRevision = mutating && SYNC_STATE_PATH.test(c.req.path);
    const userId = c.get("user").id;
    const revisionBefore = tracksRevision
      ? await getRevisionValue(c.get("db"), userId)
      : null;
    await next();
    if (
      !mutating ||
      c.req.path === "/api/notifications/token" ||
      /^\/api\/devices\/identifier\/[^/]+\/(?:token|clear-token)$/.test(
        c.req.path,
      ) ||
      c.res.status < 200 ||
      c.res.status >= 300
    )
      return;
    const revisionChanged =
      revisionBefore !== null &&
      (await getRevisionValue(c.get("db"), userId)) !== revisionBefore;
    if (!revisionChanged && !AUTH_REQUEST_PATH.test(c.req.path)) return;
    const organizationId =
      c.get("cipher")?.org_id ?? c.req.param("orgId") ?? null;
    const revisionDate = Math.floor(Date.now() / 1000);
    const originalAuthRequest = AUTH_REQUEST_PATH.test(c.req.path)
      ? c.get("authRequest")
      : null;
    const decidedAuthRequest = originalAuthRequest
      ? await getAuthRequestById(c.get("db"), originalAuthRequest.id)
      : null;
    // A rejection is intentionally silent so a forged request cannot discover
    // that the account owner acted on it. Requesting clients can still poll.
    const push =
      decidedAuthRequest?.approved === 1
        ? publishPushAuthRequestResponse(
            c.env,
            userId,
            decidedAuthRequest.id,
            decidedAuthRequest.response_device_identifier,
          )
        : originalAuthRequest
          ? Promise.resolve(false)
          : publishPushVaultChange(
              c.env,
              userId,
              organizationId,
              c.req.header("X-Device-Identifier") ?? null,
              revisionDate,
            );
    c.executionCtx.waitUntil(
      Promise.all([
        publishMutationVaultChange(c.env, userId, organizationId).catch(
          (error) => logPushRelayFailure("realtime.publish.failed", error),
        ),
        push.catch((error) =>
          logPushRelayFailure("push.publish.failed", error),
        ),
      ]),
    );
  },
);
