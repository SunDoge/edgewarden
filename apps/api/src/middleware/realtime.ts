import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env";
import { getRevisionValue } from "../services/db/revisions";
import {
	logPushRelayFailure,
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
		c.executionCtx.waitUntil(
			Promise.all([
				publishMutationVaultChange(c.env, userId, organizationId).catch(
					(error) => logPushRelayFailure("realtime.publish.failed", error),
				),
				publishPushVaultChange(
					c.env,
					userId,
					organizationId,
					c.req.header("X-Device-Identifier") ?? null,
					revisionDate,
				).catch((error) => logPushRelayFailure("push.publish.failed", error)),
			]),
		);
	},
);
