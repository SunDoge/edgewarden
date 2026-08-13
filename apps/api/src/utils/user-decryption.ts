import type { Selectable } from "kysely";
import type { Users } from "../types/db";

type UserLike = Pick<
	Selectable<Users>,
	| "email"
	| "key"
	| "kdf_type"
	| "kdf_iterations"
	| "kdf_memory"
	| "kdf_parallelism"
	| "private_key"
	| "public_key"
>;

export function buildAccountKeys(
	user: UserLike,
): Record<string, unknown> | null {
	if (!user.private_key) return null;
	return {
		publicKeyEncryptionKeyPair: {
			wrappedPrivateKey: user.private_key,
			publicKey: user.public_key ?? "",
			signedPublicKey: null,
			object: "publicKeyEncryptionKeyPair",
			Object: "publicKeyEncryptionKeyPair",
		},
		securityState: null,
		signatureKeyPair: null,
		object: "privateKeys",
		Object: "privateKeys",
	};
}

export function buildUserDecryptionOptions(
	user: UserLike,
	webAuthnPrfOption: unknown = null,
): Record<string, unknown> {
	return {
		HasMasterPassword: true,
		Object: "userDecryptionOptions",
		MasterPasswordUnlock: {
			Kdf: {
				KdfType: user.kdf_type,
				Iterations: user.kdf_iterations,
				Memory: user.kdf_memory ?? null,
				Parallelism: user.kdf_parallelism ?? null,
			},
			MasterKeyEncryptedUserKey: user.key,
			MasterKeyWrappedUserKey: user.key,
			Salt: user.email.toLowerCase(),
			Object: "masterPasswordUnlock",
		},
		TrustedDeviceOption: null,
		KeyConnectorOption: null,
		WebAuthnPrfOption: webAuthnPrfOption,
	};
}

/** Android's Kotlin sync model uses a separate camelCase wire contract. */
export function buildUserDecryptionCompat(
	user: UserLike,
	webAuthnPrfOptions: readonly unknown[] = [],
): Record<string, unknown> {
	return {
		masterPasswordUnlock: {
			kdf: {
				kdfType: user.kdf_type,
				iterations: user.kdf_iterations,
				memory: user.kdf_memory ?? null,
				parallelism: user.kdf_parallelism ?? null,
			},
			masterKeyWrappedUserKey: user.key,
			masterKeyEncryptedUserKey: user.key,
			salt: user.email.toLowerCase(),
		},
		...(webAuthnPrfOptions.length ? { webAuthnPrfOptions } : {}),
	};
}
