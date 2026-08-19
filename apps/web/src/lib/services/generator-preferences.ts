import type { GeneratorMode } from "./password-generator";

export type EmailAliasMode = "plus" | "catchall" | "subdomain";
export type SshKeyType = "ed25519" | "rsa";

export interface GeneratorPreferences {
	mode: GeneratorMode;
	length: number;
	uppercase: boolean;
	lowercase: boolean;
	numbers: boolean;
	special: boolean;
	avoidAmbiguous: boolean;
	minUppercase: number;
	minLowercase: number;
	minNumbers: number;
	minSpecial: number;
	words: number;
	separator: string;
	capitalize: boolean;
	includeNumber: boolean;
	useCustomWords: boolean;
	customWords: string;
	usernameCustomWord: string;
	pinLength: number;
	email: string;
	aliasMode: EmailAliasMode;
	aliasDomain: string;
	sshType: SshKeyType;
	rsaLength: "2048" | "3072" | "4096";
	sshComment: string;
}

export const GENERATOR_SETTINGS_KEY = "edgewarden.password-generator.v1";

export function createGeneratorPreferences(): GeneratorPreferences {
	return {
		mode: "password",
		length: 20,
		uppercase: true,
		lowercase: true,
		numbers: true,
		special: true,
		avoidAmbiguous: false,
		minUppercase: 1,
		minLowercase: 1,
		minNumbers: 1,
		minSpecial: 1,
		words: 5,
		separator: "-",
		capitalize: false,
		includeNumber: true,
		useCustomWords: false,
		customWords: "",
		usernameCustomWord: "",
		pinLength: 6,
		email: "",
		aliasMode: "plus",
		aliasDomain: "",
		sshType: "ed25519",
		rsaLength: "3072",
		sshComment: "",
	};
}

export function parseGeneratorPreferences(
	serialized: string | null,
): GeneratorPreferences {
	const defaults = createGeneratorPreferences();
	if (!serialized) return defaults;
	try {
		const parsed = JSON.parse(serialized) as unknown;
		if (!parsed || typeof parsed !== "object") return defaults;
		const source = parsed as Record<string, unknown>;
		for (const key of Object.keys(defaults) as Array<
			keyof GeneratorPreferences
		>) {
			const value = source[key];
			if (typeof value === typeof defaults[key])
				(defaults as unknown as Record<string, unknown>)[key] = value;
		}
		if (
			!["password", "passphrase", "pin", "username", "email", "ssh"].includes(
				defaults.mode,
			)
		)
			defaults.mode = "password";
		if (
			!(["plus", "catchall", "subdomain"] as string[]).includes(
				defaults.aliasMode,
			)
		)
			defaults.aliasMode = "plus";
		if (!(["ed25519", "rsa"] as string[]).includes(defaults.sshType))
			defaults.sshType = "ed25519";
		if (!(["2048", "3072", "4096"] as string[]).includes(defaults.rsaLength))
			defaults.rsaLength = "3072";
		return defaults;
	} catch {
		return defaults;
	}
}
