export interface SshKeyOptions {
  type: "ed25519" | "rsa";
  rsaLength: 2048 | 3072 | 4096;
  comment: string;
}

export interface GeneratedSshKey {
  type: "ED25519" | "RSA";
  bits: number;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

const encoder = new TextEncoder();

function concat(...chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function uint32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
}

function sshString(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return concat(uint32(bytes.length), bytes);
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) =>
    character.charCodeAt(0),
  );
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function required(jwk: JsonWebKey, property: keyof JsonWebKey): Uint8Array {
  const value = jwk[property];
  if (typeof value !== "string" || !value)
    throw new Error(`生成的密钥缺少 ${String(property)}`);
  return decodeBase64Url(value);
}

function mpint(value: Uint8Array): Uint8Array {
  let offset = 0;
  while (offset < value.length - 1 && value[offset] === 0) offset++;
  let bytes = value.subarray(offset);
  if ((bytes[0] & 0x80) !== 0) bytes = concat(new Uint8Array([0]), bytes);
  return sshString(bytes);
}

function privateEnvelope(
  publicBlob: Uint8Array,
  fields: Uint8Array[],
  comment: string,
): string {
  const check = crypto.getRandomValues(new Uint32Array(1))[0];
  let block = concat(
    uint32(check),
    uint32(check),
    ...fields,
    sshString(comment),
  );
  const paddingLength = 8 - (block.length % 8);
  block = concat(
    block,
    Uint8Array.from({ length: paddingLength }, (_, index) => index + 1),
  );
  const envelope = concat(
    encoder.encode("openssh-key-v1\0"),
    sshString("none"),
    sshString("none"),
    sshString(new Uint8Array()),
    uint32(1),
    sshString(publicBlob),
    sshString(block),
  );
  const body =
    base64(envelope)
      .match(/.{1,70}/g)
      ?.join("\n") ?? "";
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

export async function computeSshFingerprint(
  publicKey: string,
): Promise<string> {
  const encoded = publicKey.trim().split(/\s+/)[1];
  if (!encoded) throw new Error("SSH 公钥格式无效");
  const blob = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", blob));
  return `SHA256:${base64(digest).replace(/=+$/, "")}`;
}

async function generateEd25519(comment: string): Promise<GeneratedSshKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const [privateJwk, publicJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.privateKey),
    crypto.subtle.exportKey("jwk", pair.publicKey),
  ]);
  const publicBytes = required(publicJwk, "x");
  const seed = required(privateJwk, "d");
  const publicBlob = concat(sshString("ssh-ed25519"), sshString(publicBytes));
  const publicKey = `ssh-ed25519 ${base64(publicBlob)}${comment ? ` ${comment}` : ""}`;
  return {
    type: "ED25519",
    bits: 256,
    publicKey,
    privateKey: privateEnvelope(
      publicBlob,
      [
        sshString("ssh-ed25519"),
        sshString(publicBytes),
        sshString(concat(seed, publicBytes)),
      ],
      comment,
    ),
    fingerprint: await computeSshFingerprint(publicKey),
  };
}

async function generateRsa(
  length: 2048 | 3072 | 4096,
  comment: string,
): Promise<GeneratedSshKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: length,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const [n, e, d, qi, p, q] = ["n", "e", "d", "qi", "p", "q"].map((key) =>
    required(jwk, key as keyof JsonWebKey),
  );
  const publicBlob = concat(sshString("ssh-rsa"), mpint(e), mpint(n));
  const publicKey = `ssh-rsa ${base64(publicBlob)}${comment ? ` ${comment}` : ""}`;
  return {
    type: "RSA",
    bits: length,
    publicKey,
    privateKey: privateEnvelope(
      publicBlob,
      [
        sshString("ssh-rsa"),
        mpint(n),
        mpint(e),
        mpint(d),
        mpint(qi),
        mpint(p),
        mpint(q),
      ],
      comment,
    ),
    fingerprint: await computeSshFingerprint(publicKey),
  };
}

export async function generateSshKey(
  options: SshKeyOptions,
): Promise<GeneratedSshKey> {
  if (!crypto?.subtle) throw new Error("当前浏览器不支持 Web Crypto");
  const comment = options.comment.replace(/[\r\n]+/g, " ").trim();
  return options.type === "rsa"
    ? generateRsa(options.rsaLength, comment)
    : generateEd25519(comment);
}
