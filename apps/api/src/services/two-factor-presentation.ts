import type { Selectable } from "kysely";
import type { WebauthnCredentials } from "../types/db";

export function authenticatorDetails(key: string, enabled: boolean) {
  return { key, enabled };
}

export function authenticatorReadResponse(
  authenticator: ReturnType<typeof authenticatorDetails>,
  userVerificationToken: string,
) {
  return {
    authenticator,
    userVerificationToken,
    object: "twoFactorAuthenticator" as const,
  };
}

export function authenticatorUpdateResponse(
  authenticator: ReturnType<typeof authenticatorDetails>,
  recoveryCode: string,
) {
  return {
    authenticator,
    recoveryCode,
    object: "twoFactorAuthenticatorUpdate" as const,
  };
}

export function twoFactorRecoveryResponse(code: string | null) {
  return { code, object: "twoFactorRecover" as const };
}

export function webAuthnDetails(
  credentials: Selectable<WebauthnCredentials>[],
) {
  return {
    enabled: credentials.length > 0,
    keys: credentials.map((credential) => {
      if (credential.provider_key_id === null)
        throw new Error("Two-factor passkey is missing its protocol key ID");
      return {
        id: credential.provider_key_id,
        name: credential.name,
        migrated: false,
      };
    }),
  };
}

export function webAuthnReadResponse(
  webAuthn: ReturnType<typeof webAuthnDetails>,
  userVerificationToken: string,
) {
  return {
    webAuthn,
    userVerificationToken,
    object: "twoFactorWebAuthn" as const,
  };
}

export function webAuthnMutationResponse(
  webAuthn: ReturnType<typeof webAuthnDetails>,
  operation: "update" | "delete",
) {
  return {
    webAuthn,
    object:
      operation === "update"
        ? ("twoFactorWebAuthnUpdate" as const)
        : ("twoFactorWebAuthnDelete" as const),
  };
}

export interface YubiKeyDetailsExtensions {
  configured: boolean;
  canManageConfig: boolean;
}

export function yubiKeyDetails(
  keys: string[],
  nfc: boolean,
  extensions?: YubiKeyDetailsExtensions,
) {
  return {
    enabled: keys.length > 0,
    key1: keys[0] ?? null,
    key2: keys[1] ?? null,
    key3: keys[2] ?? null,
    key4: keys[3] ?? null,
    key5: keys[4] ?? null,
    nfc,
    ...extensions,
  };
}

export function yubiKeyReadResponse(
  yubiKey: ReturnType<typeof yubiKeyDetails>,
  userVerificationToken: string,
) {
  return {
    yubiKey,
    userVerificationToken,
    object: "twoFactorYubiKey" as const,
  };
}

export function yubiKeyUpdateResponse(
  yubiKey: ReturnType<typeof yubiKeyDetails>,
) {
  return { yubiKey, object: "twoFactorYubiKeyUpdate" as const };
}
