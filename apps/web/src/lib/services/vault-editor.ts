import { CipherType } from "@edgewarden/shared";
import { match } from "ts-pattern";

export interface VaultEditorForm {
  type: CipherType;
  name: string;
  notes: string;
  favorite: boolean;
  folderId: string | null;
  organizationId: string | null;
  collectionIds: string[];
  loginUsername: string;
  loginPassword: string;
  loginUri: string;
  loginUris: Array<{ uri: string; match: number | null }>;
  loginTotp: string;
  customFields: Array<{ name: string; value: string; type: number }>;
  extraData: string;
  cardholderName: string;
  cardNumber: string;
  firstName: string;
  lastName: string;
  identityNumber: string;
}

interface VaultEditorCipher {
  type: CipherType;
  name?: string | null;
  notes?: string | null;
  favorite?: boolean;
  folderId?: string | null;
  organizationId?: string | null;
  collectionIds?: string[];
  fields?: unknown[] | null;
  login?: Record<string, unknown> | null;
  card?: Record<string, unknown> | null;
  identity?: Record<string, unknown> | null;
  sshKey?: Record<string, unknown> | null;
  bankAccount?: Record<string, unknown> | null;
  driversLicense?: Record<string, unknown> | null;
  passport?: Record<string, unknown> | null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function createVaultEditorForm(
  folderId: string | null = null,
): VaultEditorForm {
  return {
    type: CipherType.Login,
    name: "",
    notes: "",
    favorite: false,
    folderId,
    organizationId: null,
    collectionIds: [],
    loginUsername: "",
    loginPassword: "",
    loginUri: "",
    loginUris: [{ uri: "", match: null }],
    loginTotp: "",
    customFields: [],
    extraData: "{}",
    cardholderName: "",
    cardNumber: "",
    firstName: "",
    lastName: "",
    identityNumber: "",
  };
}

function extraDataKey(
  type: CipherType,
): "sshKey" | "bankAccount" | "driversLicense" | "passport" | null {
  return match(type)
    .with(CipherType.SshKey, () => "sshKey" as const)
    .with(CipherType.BankAccount, () => "bankAccount" as const)
    .with(CipherType.DriversLicense, () => "driversLicense" as const)
    .with(CipherType.Passport, () => "passport" as const)
    .otherwise(() => null);
}

export function vaultCipherToEditorForm(
  cipher: VaultEditorCipher,
): VaultEditorForm {
  const form = createVaultEditorForm(cipher.folderId ?? null);
  form.type = cipher.type;
  form.name = cipher.name ?? "";
  form.notes = cipher.notes ?? "";
  form.favorite = Boolean(cipher.favorite);
  form.organizationId = cipher.organizationId ?? null;
  form.collectionIds = [...(cipher.collectionIds ?? [])];
  form.customFields = Array.isArray(cipher.fields)
    ? cipher.fields.map((value) => {
        const field = recordValue(value);
        return {
          name: stringValue(field.name),
          value: stringValue(field.value),
          type: Number(field.type ?? 0),
        };
      })
    : [];

  if (form.type === CipherType.Login) {
    const login = cipher.login || {};
    form.loginUsername = stringValue(login.username);
    form.loginPassword = stringValue(login.password);
    form.loginUri = stringValue(login.uri);
    form.loginUris =
      Array.isArray(login.uris) && login.uris.length
        ? login.uris.map((value) => {
            const entry = recordValue(value);
            return {
              uri: stringValue(entry.uri),
              match: typeof entry.match === "number" ? entry.match : null,
            };
          })
        : [{ uri: stringValue(login.uri), match: null }];
    form.loginTotp = stringValue(login.totp);
  } else if (form.type === CipherType.Card) {
    form.cardholderName = stringValue(cipher.card?.cardholderName);
    form.cardNumber = stringValue(cipher.card?.number);
  } else if (form.type === CipherType.Identity) {
    form.firstName = stringValue(cipher.identity?.firstName);
    form.lastName = stringValue(cipher.identity?.lastName);
    form.identityNumber = stringValue(cipher.identity?.number);
  } else if (form.type >= CipherType.SshKey) {
    const key = extraDataKey(form.type);
    form.extraData = JSON.stringify(key ? (cipher[key] ?? {}) : {}, null, 2);
  }
  return form;
}
