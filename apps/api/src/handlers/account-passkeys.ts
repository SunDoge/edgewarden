export {
	assertAccountPasskeyCredential,
	handleGetAccountPasskeyAssertionOptions,
} from "../services/account-passkey-auth";
export {
	buildAccountPasskeyTokenUserDecryptionOption,
	createAccountPasskey,
	deleteAccountPasskey,
	updateAccountPasskeyEncryption,
} from "./account-passkeys/credentials";
export {
	getAccountPasskeyActionAssertionOptions,
	getAccountPasskeyAttestationOptions,
	listAccountPasskeys,
} from "./account-passkeys/options";
