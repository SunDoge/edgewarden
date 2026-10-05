export interface TwoFactorPasskey {
  id: number;
  name: string | null;
  migrated: boolean;
}

export interface TwoFactorPasskeySettings {
  enabled: boolean;
  keys: TwoFactorPasskey[];
  Keys?: TwoFactorPasskey[];
  object: string;
}

export interface TwoFactorPasskeyVerification {
  webAuthn: TwoFactorPasskeySettings;
  userVerificationToken: string;
  object: string;
}

export interface TwoFactorPasskeyMutation {
  webAuthn: TwoFactorPasskeySettings;
  object: string;
}

export interface YubikeySettingsResult {
  enabled: boolean;
  key1: string | null;
  key2: string | null;
  key3: string | null;
  key4: string | null;
  key5: string | null;
  nfc: boolean;
  configured?: boolean;
  canManageConfig?: boolean;
  object: string;
}

export interface YubikeySettingsVerification {
  yubiKey: YubikeySettingsResult;
  userVerificationToken: string;
  object: string;
}

export interface YubikeySettingsMutation {
  yubiKey: YubikeySettingsResult;
  object: string;
}

export interface YubicoConfigResult {
  configured: boolean;
  object: string;
}
