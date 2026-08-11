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
			Object: "publicKeyEncryptionKeyPair",
		},
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
