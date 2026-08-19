export interface TwoFactorPasskey {
	id: string;
	name: string | null;
	migrated: boolean;
}

export interface TwoFactorPasskeySettings {
	enabled: boolean;
	keys: TwoFactorPasskey[];
	Keys?: TwoFactorPasskey[];
	object: string;
}

export interface YubikeySettingsResult {
	enabled: boolean;
	keys: string[];
	nfc: boolean;
	configured?: boolean;
	canManageConfig?: boolean;
	object: string;
}

export interface YubicoConfigResult {
	configured: boolean;
	object: string;
}
