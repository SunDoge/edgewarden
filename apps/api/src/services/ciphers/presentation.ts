import { parseJsonWithSchema } from "@edgewarden/shared";
import type { Selectable } from "kysely";
import * as v from "valibot";
import type { Attachments, Ciphers } from "../../types/db";
import { toIso } from "../../utils/time";

export type CipherPermissions = { edit: boolean; viewPassword: boolean };

export interface CipherBody {
  [key: string]: unknown;
  login?: Record<string, unknown> | null;
  secureNote?: Record<string, unknown> | null;
  card?: Record<string, unknown> | null;
  identity?: Record<string, unknown> | null;
  sshKey?: Record<string, unknown> | null;
  bankAccount?: Record<string, unknown> | null;
  driversLicense?: Record<string, unknown> | null;
  passport?: Record<string, unknown> | null;
  fields?: unknown[] | null;
  passwordHistory?: unknown[] | null;
}

const SERVER_MANAGED_CIPHER_FIELDS = new Set([
  "id",
  "organizationId",
  "folderId",
  "type",
  "name",
  "notes",
  "collectionIds",
  "favorite",
  "reprompt",
  "key",
  "fields",
  "passwordHistory",
  "attachments",
  "revisionDate",
  "creationDate",
  "deletedDate",
  "archivedDate",
  "object",
  "edit",
  "viewPassword",
  "permissions",
  "organizationUseTotp",
  "lastKnownRevisionDate",
]);
const CipherDataStorageSchema = v.record(v.string(), v.unknown());
const CipherFieldsStorageSchema = v.array(v.unknown());
const PasswordHistoryStorageSchema = v.array(v.unknown());

const EPOCH_ISO = new Date(0).toISOString();

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeFido2Dates(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((credential) => {
    if (
      !credential ||
      typeof credential !== "object" ||
      Array.isArray(credential)
    )
      return credential;
    const normalized = { ...(credential as Record<string, unknown>) };
    if ("creationDate" in normalized)
      normalized.creationDate =
        normalizeIsoDate(normalized.creationDate) ?? EPOCH_ISO;
    return normalized;
  });
}

function presentPasswordHistory(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (entry): entry is Record<string, unknown> =>
        !!entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).password === "string" &&
        Boolean((entry as Record<string, unknown>).password),
    )
    .map((entry) => ({
      ...entry,
      lastUsedDate: normalizeIsoDate(entry.lastUsedDate) ?? EPOCH_ISO,
    }));
}

function numericValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return fallback;
}

function presentFields(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (field): field is Record<string, unknown> =>
        !!field && typeof field === "object" && !Array.isArray(field),
    )
    .map((field) => ({
      ...field,
      // Bitwarden clients require a number here. Hidden is the safest fallback.
      type: numericValue(field.type, 1),
    }));
}

function presentSecureNote(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { type: 0 };
  return {
    ...(value as Record<string, unknown>),
    type: numericValue((value as Record<string, unknown>).type, 0),
  };
}

export function buildCipherData(body: CipherBody): string {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!SERVER_MANAGED_CIPHER_FIELDS.has(key) && value !== undefined) {
      data[key] = value;
    }
  }
  return JSON.stringify(data);
}

function presentLoginData(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const login = { ...(value as Record<string, unknown>) };
  const uris = Array.isArray(login.uris)
    ? login.uris.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return value;
        const uri = { ...(value as Record<string, unknown>) };
        if (uri.match != null) {
          const match = numericValue(uri.match, -1);
          uri.match = match >= 0 ? match : null;
        }
        return uri;
      })
    : null;

  if (uris) login.uris = uris;
  login.passwordRevisionDate = normalizeIsoDate(login.passwordRevisionDate);
  if ("fido2Credentials" in login)
    login.fido2Credentials = normalizeFido2Dates(login.fido2Credentials);
  // Bitwarden's API always includes this legacy alias. Some native/mobile
  // clients still require it even though `uris` is the canonical field.
  login.uri =
    uris?.length &&
    uris[0] &&
    typeof uris[0] === "object" &&
    !Array.isArray(uris[0])
      ? ((uris[0] as Record<string, unknown>).uri ?? null)
      : null;
  return login;
}

export function cipherToResponse(
  cipher: Selectable<Ciphers>,
  attachments: Selectable<Attachments>[] = [],
  collectionIds: string[] = [],
  permissions: CipherPermissions = { edit: true, viewPassword: true },
  object: "cipher" | "cipherDetails" = "cipherDetails",
) {
  const data = parseJsonWithSchema(cipher.data, CipherDataStorageSchema);
  return {
    ...data,
    id: cipher.id,
    organizationId: cipher.org_id ?? null,
    folderId: cipher.folder_id ?? null,
    type: cipher.type,
    name: cipher.name,
    notes: cipher.notes ?? null,
    fields: presentFields(
      cipher.fields
        ? parseJsonWithSchema(cipher.fields, CipherFieldsStorageSchema)
        : (data.fields ?? null),
    ),
    data: null,
    login: cipher.type === 1 ? presentLoginData(data.login ?? {}) : null,
    secureNote: cipher.type === 2 ? presentSecureNote(data.secureNote) : null,
    card: cipher.type === 3 ? (data.card ?? null) : null,
    identity: cipher.type === 4 ? (data.identity ?? null) : null,
    sshKey: cipher.type === 5 ? (data.sshKey ?? null) : null,
    bankAccount: cipher.type === 6 ? (data.bankAccount ?? null) : null,
    driversLicense: cipher.type === 7 ? (data.driversLicense ?? null) : null,
    passport: cipher.type === 8 ? (data.passport ?? null) : null,
    favorite: cipher.favorite === 1,
    reprompt: cipher.reprompt ?? 0,
    key: cipher.key ?? null,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.file_name,
      // Bitwarden's AttachmentResponseModel serializes byte size as a string.
      // Native clients deserialize this field strictly during delayed uploads.
      size: String(attachment.size),
      sizeName: attachment.size_name,
      key: attachment.key,
      object: "attachment",
    })),
    organizationUseTotp: false,
    edit: permissions.edit,
    viewPassword: permissions.viewPassword,
    permissions: { delete: permissions.edit, restore: permissions.edit },
    collectionIds,
    revisionDate: toIso(cipher.updated_at),
    creationDate: toIso(cipher.created_at),
    deletedDate: cipher.deleted_at ? toIso(cipher.deleted_at) : null,
    archivedDate: cipher.archived_at ? toIso(cipher.archived_at) : null,
    passwordHistory: presentPasswordHistory(
      cipher.password_history
        ? parseJsonWithSchema(
            cipher.password_history,
            PasswordHistoryStorageSchema,
          )
        : (data.passwordHistory ?? null),
    ),
    object,
  };
}
