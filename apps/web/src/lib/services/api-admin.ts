import { rpc, rpcJson, rpcVoid } from "./rpc";
import type {
  AdminInvite,
  AdminUser,
  ApiList,
  AuditLogEntry,
} from "./admin-types";

export interface AdminRegistrationPolicy {
  signupsAllowed: boolean;
  invitationsAllowed: boolean;
}

export interface AdminPushRelayStatus {
  enabled: boolean;
  region: "US" | "EU";
  installationIdConfigured: boolean;
  installationKeyConfigured: boolean;
  reason: "ready" | "missing_credentials" | "invalid_region";
}

export async function listAdminUsersApi(): Promise<ApiList<AdminUser>> {
  return (await rpcJson(
    await rpc.api.admin.users.$get(),
  )) as ApiList<AdminUser>;
}

export async function getAdminRegistrationPolicyApi(): Promise<AdminRegistrationPolicy> {
  return rpcJson(await rpc.api.admin.registration.$get());
}

export async function getAdminPushRelayStatusApi(): Promise<AdminPushRelayStatus> {
  return rpcJson(await rpc.api.admin["push-relay"].$get());
}

export async function updateAdminRegistrationPolicyApi(
  masterPasswordHash: string,
  signupsAllowed: boolean,
  invitationsAllowed: boolean,
): Promise<AdminRegistrationPolicy> {
  return rpcJson(
    await rpc.api.admin.registration.$put({
      json: { masterPasswordHash, signupsAllowed, invitationsAllowed },
    }),
  ) as Promise<AdminRegistrationPolicy>;
}

export async function listAdminInvitesApi(
  includeInactive = true,
): Promise<ApiList<AdminInvite>> {
  return (await rpcJson(
    await rpc.api.admin.invites.$get({
      query: { includeInactive: String(includeInactive) },
    }),
  )) as ApiList<AdminInvite>;
}

export async function createAdminInviteApi(
  masterPasswordHash: string,
  email: string,
  expiresInHours: number,
): Promise<AdminInvite> {
  return (await rpcJson(
    await rpc.api.admin.invites.$post({
      json: { masterPasswordHash, email, expiresInHours },
    }),
  )) as AdminInvite;
}

export async function deleteAdminInviteApi(
  code: string,
  masterPasswordHash: string,
): Promise<void> {
  rpcVoid(
    await rpc.api.admin.invites[":code"].$delete({
      param: { code },
      json: { masterPasswordHash },
    }),
  );
}

export async function deleteAdminInvitesApi(
  masterPasswordHash: string,
  invalidOnly = false,
): Promise<{ deleted: number }> {
  return rpcJson(
    await rpc.api.admin.invites.$delete({
      query: invalidOnly ? { scope: "invalid" } : {},
      json: { masterPasswordHash },
    }),
  ) as Promise<{ deleted: number }>;
}

export async function setAdminUserStatusApi(
  id: string,
  status: "active" | "banned",
  masterPasswordHash: string,
): Promise<void> {
  rpcVoid(
    await rpc.api.admin.users[":id"].status.$put({
      param: { id },
      json: { status, masterPasswordHash },
    }),
  );
}

export async function deleteAdminUserApi(
  id: string,
  masterPasswordHash: string,
): Promise<void> {
  rpcVoid(
    await rpc.api.admin.users[":id"].$delete({
      param: { id },
      json: { masterPasswordHash },
    }),
  );
}

export interface AuditLogQuery {
  limit?: number;
  offset?: number;
  category?: string;
  level?: string;
  q?: string;
}
export async function listAuditLogsApi(filters: AuditLogQuery = {}): Promise<{
  data: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && value !== "") query[key] = String(value);
  return rpcJson(await rpc.api.admin.logs.$get({ query })) as Promise<{
    data: AuditLogEntry[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }>;
}

export async function fetchAuditLogSettingsApi(): Promise<{
  retentionDays: number | null;
  maxEntries: number | null;
}> {
  return rpcJson(await rpc.api.admin.logs.settings.$get()) as Promise<{
    retentionDays: number | null;
    maxEntries: number | null;
  }>;
}

export async function updateAuditLogSettingsApi(settings: {
  retentionDays: 7 | 30 | 90 | 180 | 365 | null;
  maxEntries: number | null;
}): Promise<{ retentionDays: number | null; maxEntries: number | null }> {
  return rpcJson(
    await rpc.api.admin.logs.settings.$put({ json: settings }),
  ) as Promise<{ retentionDays: number | null; maxEntries: number | null }>;
}
