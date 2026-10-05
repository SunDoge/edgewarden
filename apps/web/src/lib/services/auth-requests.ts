import { long as fingerprintWords } from "@wordlist/english-eff/long";
import type { TokenResponse } from "@edgewarden/shared";
import {
  browserDeviceName,
  getOrCreateDeviceIdentifier,
  WEB_DEVICE_TYPE,
} from "./client-device";
import { rpc, rpcJson, rpcVoid } from "./rpc";
import {
  bytesToBase64,
  base64ToBytes,
  hkdfExpand,
  toBufferSource,
} from "./crypto";

export interface AuthRequest {
  id: string;
  requestDeviceIdentifier: string;
  requestDeviceTypeValue: number;
  requestDeviceType: string;
  requestIpAddress: string | null;
  requestCountryName: string | null;
  publicKey: string;
  creationDate: string;
  approved: boolean | null;
  responseDate: string | null;
  key: string | null;
  fingerprintPhrase: string;
}

interface AuthRequestsResponse {
  data?: unknown[];
}

export function normalizeAuthRequest(
  value: unknown,
): Omit<AuthRequest, "fingerprintPhrase"> {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const parsedDeviceType = Number(
    raw.requestDeviceTypeValue ??
      (typeof raw.requestDeviceType === "number" ? raw.requestDeviceType : 14),
  );
  const requestDeviceTypeValue = Number.isInteger(parsedDeviceType)
    ? parsedDeviceType
    : 14;

  return {
    id: String(raw.id ?? ""),
    requestDeviceIdentifier: String(raw.requestDeviceIdentifier ?? ""),
    requestDeviceTypeValue,
    requestDeviceType:
      typeof raw.requestDeviceType === "string" && raw.requestDeviceType
        ? raw.requestDeviceType
        : `Device type ${requestDeviceTypeValue}`,
    requestIpAddress:
      typeof raw.requestIpAddress === "string" ? raw.requestIpAddress : null,
    requestCountryName:
      typeof raw.requestCountryName === "string"
        ? raw.requestCountryName
        : null,
    publicKey: String(raw.publicKey ?? ""),
    creationDate: String(raw.creationDate ?? ""),
    approved:
      typeof raw.requestApproved === "boolean"
        ? raw.requestApproved
        : typeof raw.approved === "boolean"
          ? raw.approved
          : null,
    responseDate:
      typeof raw.responseDate === "string" ? raw.responseDate : null,
    key: typeof raw.key === "string" ? raw.key : null,
  };
}

export interface DeviceLoginRequest {
  id: string;
  email: string;
  accessCode: string;
  privateKey: CryptoKey;
  publicKey: string;
  fingerprintPhrase: string;
  creationDate: string;
}

export interface ApprovedDeviceLogin {
  request: DeviceLoginRequest;
  encKey: Uint8Array;
  macKey: Uint8Array;
}

function randomAlphanumeric(length: number): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const output: string[] = [];
  while (output.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    for (const byte of bytes) {
      // Reject the biased tail because 256 is not divisible by 62.
      if (byte >= 248) continue;
      output.push(alphabet[byte % alphabet.length]!);
      if (output.length === length) break;
    }
  }
  return output.join("");
}

export async function createDeviceLoginRequest(
  email: string,
): Promise<DeviceLoginRequest> {
  const normalizedEmail = email.trim().toLowerCase();
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
  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("spki", pair.publicKey),
  );
  const publicKey = bytesToBase64(publicKeyBytes);
  const accessCode = randomAlphanumeric(25);
  const response = normalizeAuthRequest(
    await rpcJson(
      await rpc.api["auth-requests"].$post(
        {
          json: {
            email: normalizedEmail,
            type: 0,
            deviceIdentifier: getOrCreateDeviceIdentifier(),
            accessCode,
            publicKey,
          },
        },
        {
          headers: { "Device-Type": String(WEB_DEVICE_TYPE) },
        },
      ),
    ),
  );
  return {
    id: response.id,
    email: normalizedEmail,
    accessCode,
    privateKey: pair.privateKey,
    publicKey,
    fingerprintPhrase: await publicKeyFingerprintPhrase(
      normalizedEmail,
      publicKey,
    ),
    creationDate: response.creationDate,
  };
}

export async function pollDeviceLoginRequest(
  request: DeviceLoginRequest,
): Promise<"pending" | "declined" | ApprovedDeviceLogin> {
  const response = normalizeAuthRequest(
    await rpcJson(
      await rpc.api["auth-requests"][":id"].response.$get({
        param: { id: request.id },
        query: { code: request.accessCode },
      }),
    ),
  );
  if (!response.responseDate) return "pending";
  if (!response.approved) return "declined";
  if (!response.key) throw new Error("批准响应缺少有效的保险库密钥");
  const { encKey, macKey } = await decryptApprovedVaultKey(
    response.key,
    request.privateKey,
  );

  return { request, encKey, macKey };
}

export async function decryptApprovedVaultKey(
  encryptedKey: string,
  privateKey: CryptoKey,
): Promise<{ encKey: Uint8Array; macKey: Uint8Array }> {
  if (!encryptedKey.startsWith("4."))
    throw new Error("批准响应缺少有效的保险库密钥");
  const raw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      toBufferSource(base64ToBytes(encryptedKey.slice(2))),
    ),
  );
  if (raw.length !== 64) throw new Error("批准响应中的保险库密钥长度无效");
  return { encKey: raw.slice(0, 32), macKey: raw.slice(32, 64) };
}

export async function exchangeApprovedDeviceLogin(
  approved: ApprovedDeviceLogin,
  twoFactor?: { token: string; provider?: string },
): Promise<{
  accessToken: string;
  encKey: Uint8Array;
  macKey: Uint8Array;
}> {
  const { request } = approved;
  const token = (await rpcJson(
    await rpc.identity.connect.token.$post({
      form: {
        grant_type: "password",
        username: request.email,
        password: request.accessCode,
        authRequest: request.id,
        client_id: "web",
        deviceIdentifier: getOrCreateDeviceIdentifier(),
        deviceName: browserDeviceName(),
        deviceType: String(WEB_DEVICE_TYPE),
        ...(twoFactor
          ? {
              twoFactorToken: twoFactor.token.trim(),
              twoFactorProvider: twoFactor.provider ?? "0",
            }
          : {}),
      },
    }),
  )) as TokenResponse;
  return {
    accessToken: token.access_token,
    encKey: approved.encKey,
    macKey: approved.macKey,
  };
}

export async function publicKeyFingerprintPhrase(
  email: string,
  publicKey: string,
): Promise<string> {
  // Bitwarden treats the DER-encoded public key itself as an HKDF PRK.
  const fingerprint = await hkdfExpand(
    base64ToBytes(publicKey),
    email.trim().toLowerCase(),
    32,
  );
  const entropyPerWord = Math.log2(fingerprintWords.length);
  let wordsRemaining = Math.ceil(64 / entropyPerWord);
  let value = 0n;
  for (const byte of fingerprint) value = value * 256n + BigInt(byte);

  const phrase: string[] = [];
  const wordCount = BigInt(fingerprintWords.length);
  while (wordsRemaining > 0) {
    phrase.push(fingerprintWords[Number(value % wordCount)]!);
    value /= wordCount;
    wordsRemaining -= 1;
  }
  return phrase.join("-");
}

export async function listPendingAuthRequestsApi(
  email: string,
): Promise<AuthRequest[]> {
  const result = await rpcJson<AuthRequestsResponse>(
    await rpc.api["auth-requests"].pending.$get(),
  );
  return Promise.all(
    (result.data ?? []).map(async (row) => {
      const request = normalizeAuthRequest(row);
      let fingerprintPhrase = "";
      try {
        fingerprintPhrase = await publicKeyFingerprintPhrase(
          email,
          request.publicKey,
        );
      } catch {
        /* malformed requests remain rejectable */
      }
      return { ...request, fingerprintPhrase };
    }),
  );
}

export async function encryptVaultKeyForAuthRequest(
  requestPublicKey: string,
  symEncKey: Uint8Array,
  symMacKey: Uint8Array,
): Promise<string> {
  if (symEncKey.length !== 32 || symMacKey.length !== 32)
    throw new Error("保险库密钥无效");
  const userKey = new Uint8Array(64);
  userKey.set(symEncKey, 0);
  userKey.set(symMacKey, 32);
  const publicKey = await crypto.subtle.importKey(
    "spki",
    toBufferSource(base64ToBytes(requestPublicKey)),
    { name: "RSA-OAEP", hash: "SHA-1" },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    toBufferSource(userKey),
  );
  return `4.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function respondToAuthRequestApi(
  id: string,
  approved: boolean,
  key?: string,
): Promise<void> {
  rpcVoid(
    await rpc.api["auth-requests"][":id"].$put({
      param: { id },
      json: {
        requestApproved: approved,
        deviceIdentifier: getOrCreateDeviceIdentifier(),
        key: approved ? key : null,
        masterPasswordHash: null,
      },
    }),
  );
}
