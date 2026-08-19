import {
  base64ToBytes,
  bytesToBase64,
  decryptBw,
  encryptBw,
  encryptStr,
  toBufferSource,
} from "./crypto";

function parseRsaWrapped(value: string): Uint8Array {
  const [type, payload] = value.split(".", 2);
  if (type !== "4" || !payload)
    throw new Error("Invalid organization key wrapper");
  return base64ToBytes(payload);
}

export async function importAccountPrivateKey(
  encryptedPrivateKey: string,
  accountEncKey: Uint8Array,
  accountMacKey: Uint8Array,
): Promise<CryptoKey> {
  const privateKey = await decryptBw(
    encryptedPrivateKey,
    accountEncKey,
    accountMacKey,
  );
  return crypto.subtle.importKey(
    "pkcs8",
    toBufferSource(privateKey),
    { name: "RSA-OAEP", hash: "SHA-1" },
    false,
    ["decrypt"],
  );
}

export async function unwrapOrganizationKey(
  wrappedKey: string,
  accountPrivateKey: CryptoKey,
): Promise<{ encKey: Uint8Array; macKey: Uint8Array }> {
  const raw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      accountPrivateKey,
      toBufferSource(parseRsaWrapped(wrappedKey)),
    ),
  );
  if (raw.length !== 64) throw new Error("Invalid organization key length");
  return { encKey: raw.slice(0, 32), macKey: raw.slice(32, 64) };
}

export async function wrapOrganizationKey(
  key: { encKey: Uint8Array; macKey: Uint8Array },
  publicKeyBase64: string,
): Promise<string> {
  if (key.encKey.length !== 32 || key.macKey.length !== 32)
    throw new Error("Invalid organization key");
  const raw = new Uint8Array(64);
  raw.set(key.encKey, 0);
  raw.set(key.macKey, 32);
  const publicKey = await crypto.subtle.importKey(
    "spki",
    toBufferSource(base64ToBytes(publicKeyBase64)),
    { name: "RSA-OAEP", hash: "SHA-1" },
    false,
    ["encrypt"],
  );
  return `4.${bytesToBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, toBufferSource(raw))))}`;
}

export async function createOrganizationMaterials(
  accountPublicKey: string,
  collectionName: string,
) {
  const raw = crypto.getRandomValues(new Uint8Array(64));
  const key = { encKey: raw.slice(0, 32), macKey: raw.slice(32, 64) };
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
  return {
    key,
    wrappedMemberKey: await wrapOrganizationKey(key, accountPublicKey),
    publicKey: bytesToBase64(publicKey),
    encryptedPrivateKey: await encryptBw(privateKey, key.encKey, key.macKey),
    encryptedCollectionName: await encryptStr(
      collectionName,
      key.encKey,
      key.macKey,
    ),
  };
}
