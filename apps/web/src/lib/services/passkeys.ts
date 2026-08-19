import {
	base64ToBytes,
	bytesToBase64,
	bytesToBase64Url,
	base64UrlToBytes,
	decryptBw,
	encryptBw,
	hkdfExpand,
	toBufferSource,
} from "./crypto";

const LOGIN_WITH_PRF_SALT = "passwordless-login";

export interface AccountPasskeyAssertion {
	token: string;
	deviceResponse: Record<string, unknown>;
	prfKey?: Uint8Array;
}

export interface PendingAccountPasskeyCredential {
	token: string;
	createOptions: PublicKeyCredentialCreationOptions;
	deviceResponse: PublicKeyCredential;
	request: Record<string, unknown>;
	supportsPrf: boolean;
}

export interface AccountPasskeyPrfKeySet {
	encryptedUserKey: string;
	encryptedPublicKey: string;
	encryptedPrivateKey: string;
}

export class AccountPasskeyPrfUnavailableError extends Error {
	constructor() {
		super("这把通行密钥不支持直接解密保险库 (PRF)");
		this.name = "AccountPasskeyPrfUnavailableError";
	}
}

type SerializedCredentialDescriptor = Omit<
	PublicKeyCredentialDescriptor,
	"id"
> & { id: string };
type SerializedCreationOptions = Omit<
	PublicKeyCredentialCreationOptions,
	"challenge" | "user" | "excludeCredentials"
> & {
	challenge: string;
	user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
	excludeCredentials?: SerializedCredentialDescriptor[];
};
type SerializedRequestOptions = Omit<
	PublicKeyCredentialRequestOptions,
	"challenge" | "allowCredentials"
> & {
	challenge: string;
	allowCredentials?: SerializedCredentialDescriptor[];
};

function cloneCreationOptions(
	options: unknown,
): PublicKeyCredentialCreationOptions {
	if (!options || typeof options !== "object") {
		throw new Error("无效的通行密钥创建选项");
	}
	const source = options as SerializedCreationOptions;
	return {
		...source,
		challenge: toBufferSource(base64UrlToBytes(source.challenge)),
		user: {
			...source.user,
			id: toBufferSource(base64UrlToBytes(source.user?.id)),
		},
		excludeCredentials: Array.isArray(source.excludeCredentials)
			? source.excludeCredentials.map((credential) => ({
					...credential,
					id: toBufferSource(base64UrlToBytes(credential.id)),
				}))
			: undefined,
	};
}

function cloneRequestOptions(
	options: unknown,
): PublicKeyCredentialRequestOptions {
	if (!options || typeof options !== "object") {
		throw new Error("无效的通行密钥验证选项");
	}
	const source = options as SerializedRequestOptions;
	return {
		...source,
		challenge: toBufferSource(base64UrlToBytes(source.challenge)),
		allowCredentials: Array.isArray(source.allowCredentials)
			? source.allowCredentials.map((credential) => ({
					...credential,
					id: toBufferSource(base64UrlToBytes(credential.id)),
				}))
			: source.allowCredentials,
	};
}

async function getLoginWithPrfSalt(): Promise<Uint8Array> {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		toBufferSource(new TextEncoder().encode(LOGIN_WITH_PRF_SALT)),
	);
	return new Uint8Array(hash);
}

function credentialIdToBase64Url(id: BufferSource): string | null {
	try {
		const bytes =
			id instanceof ArrayBuffer
				? new Uint8Array(id)
				: new Uint8Array(id.buffer, id.byteOffset, id.byteLength);
		return bytesToBase64Url(bytes);
	} catch {
		return null;
	}
}

function buildLegacyPrfExtension(
	salt: Uint8Array,
): AuthenticationExtensionsClientInputs {
	const evalInput: AuthenticationExtensionsPRFValues = {
		first: toBufferSource(salt),
	};
	return {
		prf: {
			eval: evalInput,
		},
	};
}

function buildCredentialPrfExtension(
	salt: Uint8Array,
	credentialIds: Array<string | null | undefined>,
): AuthenticationExtensionsClientInputs {
	const evalInput: AuthenticationExtensionsPRFValues = {
		first: toBufferSource(salt),
	};
	const evalByCredential = credentialIds
		.filter((id): id is string => !!id)
		.reduce<Record<string, AuthenticationExtensionsPRFValues>>((out, id) => {
			out[id] = evalInput;
			return out;
		}, {});
	if (!Object.keys(evalByCredential).length)
		return buildLegacyPrfExtension(salt);
	return {
		prf: {
			evalByCredential,
		},
	};
}

function withPrfExtension(
	options: PublicKeyCredentialRequestOptions,
	extension: AuthenticationExtensionsClientInputs,
): PublicKeyCredentialRequestOptions {
	return {
		...options,
		extensions: {
			...(options.extensions ?? {}),
			...extension,
		},
	};
}

function readPrfFirstResult(
	credential: PublicKeyCredential,
): ArrayBuffer | undefined {
	const result = credential.getClientExtensionResults().prf?.results?.first;
	if (!result) return undefined;
	if (result instanceof ArrayBuffer) return result;
	return new Uint8Array(
		result.buffer,
		result.byteOffset,
		result.byteLength,
	).slice().buffer;
}

function hasPrfExtensionResult(credential: PublicKeyCredential): boolean {
	return Object.prototype.hasOwnProperty.call(
		credential.getClientExtensionResults(),
		"prf",
	);
}

function shouldRetryWithLegacyPrf(error: unknown): boolean {
	const name =
		error instanceof DOMException || error instanceof Error ? error.name : "";
	return (
		name === "NotSupportedError" ||
		name === "SyntaxError" ||
		name === "TypeError"
	);
}

async function getPublicKeyCredentialWithPrf(
	options: PublicKeyCredentialRequestOptions,
	salt: Uint8Array,
	credentialIds: string[],
): Promise<PublicKeyCredential> {
	const attempts = [
		() =>
			navigator.credentials.get({
				publicKey: withPrfExtension(
					options,
					buildCredentialPrfExtension(salt, credentialIds),
				),
			}),
		() =>
			navigator.credentials.get({
				publicKey: withPrfExtension(options, buildLegacyPrfExtension(salt)),
			}),
		() => navigator.credentials.get({ publicKey: options }),
	];

	let lastCredential: PublicKeyCredential | null = null;
	for (let index = 0; index < attempts.length; index++) {
		try {
			const credential = await attempts[index]();
			if (!(credential instanceof PublicKeyCredential)) {
				throw new Error("未选择通行密钥");
			}
			lastCredential = credential;
			if (
				readPrfFirstResult(credential) ||
				hasPrfExtensionResult(credential) ||
				index === attempts.length - 1
			) {
				return credential;
			}
		} catch (error) {
			if (index === attempts.length - 1 || !shouldRetryWithLegacyPrf(error)) {
				if (lastCredential) return lastCredential;
				throw error;
			}
		}
	}
	if (lastCredential) return lastCredential;
	throw new Error("未选择通行密钥");
}

function publicKeyCredentialBase(
	credential: PublicKeyCredential,
): Record<string, unknown> {
	return {
		id: credential.id,
		rawId: bytesToBase64Url(new Uint8Array(credential.rawId)),
		type: credential.type,
		extensions: {},
	};
}

function assertionRequest(
	credential: PublicKeyCredential,
): Record<string, unknown> {
	if (!(credential.response instanceof AuthenticatorAssertionResponse)) {
		throw new Error("无效的通行密钥验证响应");
	}
	return {
		...publicKeyCredentialBase(credential),
		response: {
			authenticatorData: bytesToBase64Url(
				new Uint8Array(credential.response.authenticatorData),
			),
			signature: bytesToBase64Url(
				new Uint8Array(credential.response.signature),
			),
			clientDataJSON: bytesToBase64Url(
				new Uint8Array(credential.response.clientDataJSON),
			),
			userHandle: credential.response.userHandle
				? bytesToBase64Url(new Uint8Array(credential.response.userHandle))
				: undefined,
		},
	};
}

function attestationRequest(
	credential: PublicKeyCredential,
): Record<string, unknown> {
	if (!(credential.response instanceof AuthenticatorAttestationResponse)) {
		throw new Error("无效的通行密钥注册响应");
	}
	const transports =
		typeof credential.response.getTransports === "function"
			? credential.response.getTransports()
			: undefined;
	return {
		...publicKeyCredentialBase(credential),
		response: {
			attestationObject: bytesToBase64Url(
				new Uint8Array(credential.response.attestationObject),
			),
			clientDataJson: bytesToBase64Url(
				new Uint8Array(credential.response.clientDataJSON),
			),
			transports,
		},
	};
}

export async function assertAccountPasskey(response: {
	options: unknown;
	token: string;
}): Promise<AccountPasskeyAssertion> {
	if (!window.PublicKeyCredential || !navigator.credentials) {
		throw new Error("您的浏览器不支持通行密钥 (WebAuthn)");
	}
	const nativeOptions = cloneRequestOptions(response.options);
	const credential = await getPublicKeyCredentialWithPrf(
		nativeOptions,
		await getLoginWithPrfSalt(),
		prfCredentialIdsFromAllowCredentials(nativeOptions),
	);
	const prfResult = readPrfFirstResult(credential);
	return {
		token: response.token,
		deviceResponse: assertionRequest(credential),
		prfKey: prfResult ? await prfOutputToKey(prfResult) : undefined,
	};
}

export async function createAccountPasskeyCredential(response: {
	options: unknown;
	token: string;
}): Promise<PendingAccountPasskeyCredential> {
	if (!window.PublicKeyCredential || !navigator.credentials) {
		throw new Error("您的浏览器不支持通行密钥 (WebAuthn)");
	}
	const nativeOptions = cloneCreationOptions(response.options);
	nativeOptions.extensions = {
		...(nativeOptions.extensions ?? {}),
		prf: {},
	};
	const credential = await navigator.credentials.create({
		publicKey: nativeOptions,
	});
	if (!(credential instanceof PublicKeyCredential)) {
		throw new Error("没有创建任何通行密钥");
	}
	const supportsPrf = !!credential.getClientExtensionResults().prf?.enabled;
	return {
		token: response.token,
		createOptions: nativeOptions,
		deviceResponse: credential,
		request: attestationRequest(credential),
		supportsPrf,
	};
}

export async function createTwoFactorPasskeyCredential(response: {
	options: unknown;
	token: string;
}): Promise<{ token: string; deviceResponse: Record<string, unknown> }> {
	const pending = await createAccountPasskeyCredential(response);
	return { token: pending.token, deviceResponse: pending.request };
}

export async function assertTwoFactorPasskeyCredential(response: {
	options: unknown;
	token: string;
}): Promise<{ token: string; deviceResponse: Record<string, unknown> }> {
	if (!window.PublicKeyCredential || !navigator.credentials)
		throw new Error("您的浏览器不支持 WebAuthn 安全密钥");
	const credential = await navigator.credentials.get({
		publicKey: cloneRequestOptions(response.options),
	});
	if (!(credential instanceof PublicKeyCredential))
		throw new Error("未选择安全密钥");
	return {
		token: response.token,
		deviceResponse: assertionRequest(credential),
	};
}

function prfCredentialIdsFromAllowCredentials(
	options: PublicKeyCredentialRequestOptions,
): string[] {
	return (options.allowCredentials || [])
		.map((credential) => credentialIdToBase64Url(credential.id))
		.filter((id): id is string => !!id);
}

async function prfOutputToKey(prfOutput: ArrayBuffer): Promise<Uint8Array> {
	const prf = new Uint8Array(prfOutput);
	const enc = await hkdfExpand(prf, "enc", 32);
	const mac = await hkdfExpand(prf, "mac", 32);
	const out = new Uint8Array(64);
	out.set(enc, 0);
	out.set(mac, 32);
	return out;
}

function parseRsaEncryptedUserKey(value: string): Uint8Array {
	const text = String(value || "").trim();
	const [type, payload] = text.split(".");
	if (type !== "4" || !payload) throw new Error("不支持的加密用户密钥格式");
	return base64ToBytes(payload);
}

export async function buildAccountPasskeyPrfKeySet(
	pending: PendingAccountPasskeyCredential,
	userKey: { symEncKey: string; symMacKey: string },
): Promise<AccountPasskeyPrfKeySet> {
	const rawId = new Uint8Array(pending.deviceResponse.rawId);
	const credentialId = bytesToBase64Url(rawId);
	if (!pending.createOptions?.challenge)
		throw new Error("通行密钥注册挑战已丢失，请重新创建");
	const assertionOptions: PublicKeyCredentialRequestOptions = {
		challenge: pending.createOptions.challenge,
		rpId: pending.createOptions?.rp?.id,
		allowCredentials: [{ id: toBufferSource(rawId), type: "public-key" }],
		timeout: pending.createOptions?.timeout,
		userVerification:
			pending.createOptions?.authenticatorSelection?.userVerification,
	};
	const assertion = await getPublicKeyCredentialWithPrf(
		assertionOptions,
		await getLoginWithPrfSalt(),
		[credentialId],
	);
	const prfResult = readPrfFirstResult(assertion);
	if (!prfResult) {
		throw new AccountPasskeyPrfUnavailableError();
	}
	return buildAccountPasskeyPrfKeySetFromPrfKey(
		await prfOutputToKey(prfResult),
		userKey,
	);
}

export async function buildAccountPasskeyPrfKeySetFromPrfKey(
	prfKey: Uint8Array,
	userKey: { symEncKey: string; symMacKey: string },
): Promise<AccountPasskeyPrfKeySet> {
	const userKeyBytes = new Uint8Array(64);
	userKeyBytes.set(base64ToBytes(userKey.symEncKey), 0);
	userKeyBytes.set(base64ToBytes(userKey.symMacKey), 32);

	const pair = await crypto.subtle.generateKey(
		{
			name: "RSA-OAEP",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-1",
		},
		true,
		["encrypt", "decrypt"],
	);
	const publicKey = new Uint8Array(
		await crypto.subtle.exportKey("spki", pair.publicKey),
	);
	const privateKey = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", pair.privateKey),
	);
	const encryptedUserKeyBytes = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "RSA-OAEP" },
			pair.publicKey,
			toBufferSource(userKeyBytes),
		),
	);

	return {
		encryptedUserKey: `4.${bytesToBase64(encryptedUserKeyBytes)}`,
		encryptedPublicKey: await encryptBw(
			publicKey,
			userKeyBytes.slice(0, 32),
			userKeyBytes.slice(32, 64),
		),
		encryptedPrivateKey: await encryptBw(
			privateKey,
			prfKey.slice(0, 32),
			prfKey.slice(32, 64),
		),
	};
}

export async function unlockVaultKeyWithAccountPasskeyPrf(
	prfKey: Uint8Array,
	option: {
		EncryptedPrivateKey?: string;
		encryptedPrivateKey?: string;
		EncryptedUserKey?: string;
		encryptedUserKey?: string;
	},
): Promise<{ symEncKey: string; symMacKey: string }> {
	const encryptedPrivateKey =
		option.EncryptedPrivateKey || option.encryptedPrivateKey || "";
	const encryptedUserKey =
		option.EncryptedUserKey || option.encryptedUserKey || "";
	if (!encryptedPrivateKey || !encryptedUserKey) {
		throw new Error("该通行密钥无法解锁保险库");
	}
	const privateKeyBytes = await decryptBw(
		encryptedPrivateKey,
		prfKey.slice(0, 32),
		prfKey.slice(32, 64),
	);
	const privateKey = await crypto.subtle.importKey(
		"pkcs8",
		toBufferSource(privateKeyBytes),
		{ name: "RSA-OAEP", hash: "SHA-1" },
		false,
		["decrypt"],
	);
	const userKeyBytes = new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: "RSA-OAEP" },
			privateKey,
			toBufferSource(parseRsaEncryptedUserKey(encryptedUserKey)),
		),
	);
	if (userKeyBytes.length < 64) throw new Error("解密保险库密钥失败");
	return {
		symEncKey: bytesToBase64(userKeyBytes.slice(0, 32)),
		symMacKey: bytesToBase64(userKeyBytes.slice(32, 64)),
	};
}
