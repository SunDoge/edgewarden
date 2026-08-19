import type {
  AttachmentResponse,
  CipherType,
  CipherResponse,
  CollectionResponse,
  FolderResponse,
  ProfileOrganizationResponse,
} from "@edgewarden/shared";

export interface VaultLoginData extends Record<string, unknown> {
  username?: string;
  password?: string;
  totp?: string;
  uri?: string;
  uris?: Array<{ uri?: string }>;
}

export interface VaultCardData extends Record<string, unknown> {
  cardholderName?: string;
  number?: string;
  brand?: string;
  expMonth?: string;
  expYear?: string;
  code?: string;
}

export interface VaultIdentityData extends Record<string, unknown> {
  username?: string;
  email?: string;
  phone?: string;
  number?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface VaultCustomField extends Record<string, unknown> {
  name?: string;
  value?: string | boolean;
  type?: string | number;
}

export interface VaultPasswordHistory extends Record<string, unknown> {
  password?: string;
  lastUsedDate?: string;
}

export interface VaultAttachment extends AttachmentResponse {
  _keys: { enc: Uint8Array; mac: Uint8Array };
}

export type VaultCipher = Omit<
  CipherResponse,
  | "attachments"
  | "card"
  | "fields"
  | "identity"
  | "login"
  | "passwordHistory"
  | "type"
> & {
  type: CipherType;
  attachments: VaultAttachment[] | null;
  card: VaultCardData | null;
  fields: VaultCustomField[] | null;
  identity: VaultIdentityData | null;
  login: VaultLoginData | null;
  passwordHistory: VaultPasswordHistory[] | null;
  readOnly?: boolean;
  hidePasswords?: boolean;
};

export type VaultFolder = FolderResponse;
export type VaultCollection = CollectionResponse;
export type VaultOrganization = ProfileOrganizationResponse;
export interface VaultTotp {
  code: string;
  remain: number;
  period?: number;
}
