import type { Context } from "hono";
import type { HonoEnv } from "../../env";
import {
  logPushRelayFailure,
  publishPushOrganizationKeys,
} from "../push-relay";
import { publishVaultChange } from "../realtime";

/** Call only after committing membership changes, including member removal. */
export function notifyOrganizationMemberChange(
  c: Context<HonoEnv>,
  userId: string | null,
) {
  if (!userId) return;
  // Address the affected account directly: removed members are no longer in
  // organization fan-out, and newly added members may not be registered there yet.
  c.executionCtx.waitUntil(
    Promise.all([
      publishVaultChange(c.env, [userId]).catch((error) =>
        logPushRelayFailure("organization.realtime.failed", error),
      ),
      publishPushOrganizationKeys(c.env, userId).catch((error) =>
        logPushRelayFailure("organization.push.failed", error),
      ),
    ]),
  );
}
