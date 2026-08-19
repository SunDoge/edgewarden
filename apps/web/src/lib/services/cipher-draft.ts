import { CipherType, parseJsonWithSchema } from "@edgewarden/shared";
import { match } from "ts-pattern";
import * as v from "valibot";
import type { VaultCipher } from "./vault-types";

export interface CipherDraft {
  type: CipherType;
  name: string;
  notes: string;
  favorite: boolean;
  folderId: string | null;
  login: {
    username: string;
    password: string;
    uri: string;
    uris: Array<{ uri: string; match: number | null }>;
    totp: string;
  };
  card: { cardholderName: string; number: string };
  identity: { firstName: string; lastName: string; number: string };
  customFields: Array<{ name: string; value: string; type: number }>;
  extraData: string;
}

export type CipherDraftPayload = Record<string, unknown> & {
  type: number;
  name: string;
  notes: string | null;
  favorite: boolean;
  folderId: string | null;
  passwordHistory?: Array<{ password?: string; lastUsedDate?: string }> | null;
};

export function buildCipherPayload(
  draft: CipherDraft,
  selectedItem: Partial<VaultCipher> | null,
  editing: boolean,
  now = new Date(),
): CipherDraftPayload {
  if (!draft.name.trim()) throw new Error("名称不能为空");
  const payload: CipherDraftPayload = {
    type: draft.type,
    name: draft.name.trim(),
    notes: draft.notes.trim() || null,
    favorite: draft.favorite,
    folderId: draft.folderId || null,
    key: selectedItem?.key || null,
  };

  match(draft.type)
    .with(CipherType.Login, () => {
      const uris = draft.login.uris
        .filter((entry) => entry.uri.trim())
        .map((entry) => ({ uri: entry.uri.trim(), match: entry.match }));
      payload.login = {
        ...(selectedItem?.login ?? {}),
        username: draft.login.username.trim() || null,
        password: draft.login.password || null,
        uri: (uris[0]?.uri ?? draft.login.uri.trim()) || null,
        uris,
        totp: draft.login.totp.trim() || null,
      };
      payload.passwordHistory =
        editing &&
        selectedItem?.login?.password &&
        selectedItem.login.password !== draft.login.password
          ? [
              {
                password: selectedItem.login.password,
                lastUsedDate: now.toISOString(),
              },
              ...(selectedItem.passwordHistory ?? []),
            ].slice(0, 20)
          : (selectedItem?.passwordHistory ?? null);
    })
    .with(CipherType.Card, () => {
      payload.card = {
        ...(selectedItem?.card ?? {}),
        cardholderName: draft.card.cardholderName.trim() || null,
        number: draft.card.number.trim() || null,
      };
    })
    .with(CipherType.Identity, () => {
      payload.identity = {
        ...(selectedItem?.identity ?? {}),
        firstName: draft.identity.firstName.trim() || null,
        lastName: draft.identity.lastName.trim() || null,
        number: draft.identity.number.trim() || null,
      };
    })
    .with(CipherType.SecureNote, () => {
      payload.secureNote = {
        ...(selectedItem?.secureNote ?? {}),
        type: selectedItem?.secureNote?.type ?? 0,
      };
    })
    .otherwise((type) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = parseJsonWithSchema(
          draft.extraData || "{}",
          v.record(v.string(), v.unknown()),
        );
      } catch {
        throw new Error("类型数据必须是有效的 JSON");
      }
      const key = match(type)
        .with(CipherType.SshKey, () => "sshKey" as const)
        .with(CipherType.BankAccount, () => "bankAccount" as const)
        .with(CipherType.DriversLicense, () => "driversLicense" as const)
        .with(CipherType.Passport, () => "passport" as const)
        .otherwise(() => "secureNote" as const);
      payload[key] = { ...(selectedItem?.[key] ?? {}), ...parsed };
    });
  payload.fields = draft.customFields
    .filter((field) => field.name.trim())
    .map((field) => ({
      name: field.name.trim(),
      value: field.value,
      type: field.type,
    }));
  return payload;
}
