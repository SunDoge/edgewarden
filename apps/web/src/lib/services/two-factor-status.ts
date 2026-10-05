import type { TwoFactorProvider } from "./account-types";

export interface TwoFactorStatus {
  enabled: boolean;
  totpEnabled: boolean;
  otherEnabled: boolean;
}

/** Keeps the TOTP card independent from WebAuthn and YubiKey providers. */
export function summarizeTwoFactorProviders(
  providers: TwoFactorProvider[],
): TwoFactorStatus {
  const enabledProviders = providers.filter((provider) => provider.enabled);
  return {
    enabled: enabledProviders.length > 0,
    totpEnabled: enabledProviders.some((provider) => provider.type === 0),
    otherEnabled: enabledProviders.some((provider) => provider.type !== 0),
  };
}
