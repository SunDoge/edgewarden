import type { Kysely } from "kysely";
import { createDatabase } from "../middleware/db";
import type { DB } from "../types/db";
import { now } from "../utils/time";
import {
  requireFreshDataOperationLease,
  withDataOperationLease,
} from "./backup/operation-lease";
import { type BlobGcResult, drainBlobGcQueue } from "./blob-gc";
import { createBlobStore } from "./blob-store";

const AUTH_REQUEST_RETENTION_SECONDS = 24 * 60 * 60;
const LOGIN_ATTEMPT_RETENTION_SECONDS = 24 * 60 * 60;

export interface MaintenanceResult {
  refreshTokens: number;
  deviceTrustTokens: number;
  webauthnChallenges: number;
  attachmentDownloadTokens: number;
  authRequests: number;
  loginAttempts: number;
  expiredInvites: number;
  /** @deprecated Published vault records are retained and this is always zero. */
  purgedAttachments: 0;
  /** @deprecated Published vault records are retained and this is always zero. */
  purgedCiphers: 0;
  /** @deprecated Published vault records are retained and this is always zero. */
  purgedSends: 0;
  /** @deprecated Published vault records are retained and this is always zero. */
  purgedOrganizations: 0;
  /** @deprecated Published vault records are retained and this is always zero. */
  purgedUsers: 0;
  blobGc: BlobGcResult;
}

function affectedRows(result: {
  numDeletedRows?: bigint;
  numUpdatedRows?: bigint;
}) {
  return Number(result.numDeletedRows ?? result.numUpdatedRows ?? 0n);
}

export async function runMaintenance(
  db: Kysely<DB>,
  env: CloudflareBindings,
  timestamp = now(),
  checkpoint?: () => Promise<void>,
): Promise<MaintenanceResult> {
  const blobStore = createBlobStore(env);
  if (!blobStore) throw new Error("Attachment storage is not configured");
  const refreshTokens = affectedRows(
    await db
      .deleteFrom("refresh_tokens")
      .where("expires_at", "<=", timestamp)
      .executeTakeFirst(),
  );
  const deviceTrustTokens = affectedRows(
    await db
      .deleteFrom("device_trust_tokens")
      .where("expires_at", "<=", timestamp)
      .executeTakeFirst(),
  );
  const expiredWebauthnChallenges = affectedRows(
    await db
      .deleteFrom("webauthn_challenges")
      .where("expires_at", "<=", timestamp)
      .executeTakeFirst(),
  );
  const usedWebauthnChallenges = affectedRows(
    await db
      .deleteFrom("webauthn_challenges")
      .where("used_at", "is not", null)
      .executeTakeFirst(),
  );
  const webauthnChallenges = expiredWebauthnChallenges + usedWebauthnChallenges;
  const attachmentDownloadTokens = affectedRows(
    await db
      .deleteFrom("attachment_download_tokens")
      .where("expires_at", "<=", timestamp)
      .executeTakeFirst(),
  );
  const authRequests = affectedRows(
    await db
      .deleteFrom("auth_requests")
      .where("creation_date", "<=", timestamp - AUTH_REQUEST_RETENTION_SECONDS)
      .executeTakeFirst(),
  );
  const loginAttempts = affectedRows(
    await db
      .deleteFrom("login_attempts")
      .where("updated_at", "<=", timestamp - LOGIN_ATTEMPT_RETENTION_SECONDS)
      .executeTakeFirst(),
  );
  const expiredInvites = affectedRows(
    await db
      .updateTable("invites")
      .set({ status: "expired", updated_at: timestamp })
      .where("status", "=", "active")
      .where("expires_at", "<=", timestamp)
      .executeTakeFirst(),
  );
  await checkpoint?.();
  // Vault records and their published blobs are deliberately retained after
  // logical deletion. This keeps the encrypted source material available for
  // audit and disaster recovery. The blob GC queue only contains unpublished,
  // replaced, or failed-restore objects that are not referenced by vault rows.
  const blobGc = await drainBlobGcQueue(db, blobStore, timestamp);
  return {
    refreshTokens,
    deviceTrustTokens,
    webauthnChallenges,
    attachmentDownloadTokens,
    authRequests,
    loginAttempts,
    expiredInvites,
    purgedAttachments: 0,
    purgedCiphers: 0,
    purgedSends: 0,
    purgedOrganizations: 0,
    purgedUsers: 0,
    blobGc,
  };
}

export async function runScheduledMaintenance(
  env: CloudflareBindings,
): Promise<MaintenanceResult> {
  return withDataOperationLease(
    env.DB,
    "maintenance.scheduled",
    async (lease) => {
      const { db } = await createDatabase(env.DB);
      try {
        return await runMaintenance(db, env, now(), () =>
          requireFreshDataOperationLease(env.DB, lease),
        );
      } finally {
        await db.destroy();
      }
    },
  );
}
