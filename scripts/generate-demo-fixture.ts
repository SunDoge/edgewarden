// Offline generator: print public synthetic data as JSON. No real credentials.
// Precomputing RSA/KDF work keeps it out of the first Worker request.
import {
  bytesToBase64,
  deriveMasterKey,
  deriveMasterPasswordHash,
  encryptBw,
  hkdfExpand,
} from "../apps/web/src/lib/services/crypto.ts";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_USER_ID,
} from "../apps/api/src/demo/policy.ts";

const stamp = 1791590400;
const uuid = (n: number) =>
  `de000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const master = new Uint8Array(
  await deriveMasterKey(DEMO_PASSWORD, DEMO_EMAIL, 600000),
);
const hash = await deriveMasterPasswordHash(master.buffer, DEMO_PASSWORD);
const vault = crypto.getRandomValues(new Uint8Array(64));
const org = crypto.getRandomValues(new Uint8Array(64));
const enc = (value: string | Uint8Array, key = vault) =>
  encryptBw(
    typeof value === "string" ? new TextEncoder().encode(value) : value,
    key.slice(0, 32),
    key.slice(32),
  );
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
const serverMaterial = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(hash),
  "PBKDF2",
  false,
  ["deriveBits"],
);
const serverHash = new Uint8Array(
  await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(DEMO_EMAIL),
      iterations: 100000,
    },
    serverMaterial,
    256,
  ),
);
type Row = Record<string, string | number | null>;
const rows: { table: string; row: Row }[] = [];
const add = (table: string, row: Row) => rows.push({ table, row });
add("users", {
  id: DEMO_USER_ID,
  email: DEMO_EMAIL,
  name: "Edgewarden Demo",
  master_password_hash: `$s$${bytesToBase64(serverHash)}`,
  key: await encryptBw(
    vault,
    await hkdfExpand(master, "enc", 32),
    await hkdfExpand(master, "mac", 32),
  ),
  private_key: await enc(
    new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
  ),
  public_key: bytesToBase64(
    new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)),
  ),
  master_password_salt: DEMO_EMAIL,
  user_key_id: "de000000000040008000000000000001",
  kdf_type: 0,
  kdf_iterations: 600000,
  security_stamp: uuid(99),
  role: "user",
  verify_devices: 0,
  created_at: stamp,
  updated_at: stamp,
});
add("user_revisions", { user_id: DEMO_USER_ID, revision_date: stamp });
add("folders", {
  id: uuid(2),
  user_id: DEMO_USER_ID,
  name: await enc("示例保险库"),
  created_at: stamp,
  updated_at: stamp,
});
async function cipher(
  n: number,
  type: number,
  name: string,
  data: object,
  organization = false,
) {
  const key = organization ? org : vault;
  add("ciphers", {
    id: uuid(n),
    user_id: organization ? null : DEMO_USER_ID,
    org_id: organization ? uuid(10) : null,
    folder_id: organization ? null : uuid(2),
    type,
    name: await enc(name, key),
    notes: await enc("仅供演示，不是真实凭据。", key),
    data: JSON.stringify(data),
    favorite: n === 3 ? 1 : 0,
    created_at: stamp,
    updated_at: stamp,
  });
}
await cipher(3, 1, "示例网站", {
  login: {
    username: await enc("demo@example.com"),
    password: await enc("Not-A-Real-Password!"),
    uris: [{ uri: await enc("https://example.com"), match: null }],
    totp: await enc("JBSWY3DPEHPK3PXP"),
  },
});
await cipher(4, 2, "欢迎使用 Edgewarden", { secureNote: { type: 0 } });
await cipher(5, 3, "测试信用卡", {
  card: {
    cardholderName: await enc("DEMO USER"),
    brand: await enc("Visa"),
    number: await enc("4111111111111111"),
    expMonth: await enc("12"),
    expYear: await enc("2030"),
    code: await enc("123"),
  },
});
await cipher(6, 4, "虚构身份", {
  identity: {
    firstName: await enc("Demo"),
    lastName: await enc("User"),
    email: await enc("demo@example.com"),
  },
});
add("organizations", {
  id: uuid(10),
  name: "Edgewarden 示例组织",
  created_at: stamp,
  updated_at: stamp,
});
add("org_members", {
  id: uuid(11),
  org_id: uuid(10),
  user_id: DEMO_USER_ID,
  email: DEMO_EMAIL,
  key: `4.${bytesToBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, org)))}`,
  role: "member",
  status: "confirmed",
  access_all: 0,
  created_at: stamp,
  updated_at: stamp,
});
add("collections", {
  id: uuid(12),
  org_id: uuid(10),
  name: await enc("团队共享示例", org),
  created_at: stamp,
  updated_at: stamp,
});
add("collection_members", {
  collection_id: uuid(12),
  org_member_id: uuid(11),
  org_id: uuid(10),
  read_only: 1,
  hide_passwords: 0,
  manage: 0,
});
await cipher(
  13,
  1,
  "组织共享登录",
  {
    login: {
      username: await enc("team@example.com", org),
      password: await enc("Team-Demo-Only!", org),
      uris: [],
    },
  },
  true,
);
add("cipher_collections", {
  cipher_id: uuid(13),
  collection_id: uuid(12),
  org_id: uuid(10),
});
const rawSend = crypto.getRandomValues(new Uint8Array(16));
const sendMaterial = await crypto.subtle.importKey(
  "raw",
  rawSend,
  "HKDF",
  false,
  ["deriveBits"],
);
const sendKeys = new Uint8Array(
  await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("bitwarden-send"),
      info: new TextEncoder().encode("send"),
    },
    sendMaterial,
    512,
  ),
);
add("sends", {
  id: uuid(20),
  user_id: DEMO_USER_ID,
  type: 0,
  name: await enc("只读文本 Send", sendKeys),
  data: JSON.stringify({
    text: await enc("欢迎试用 Edgewarden。所有内容均为虚构示例。", sendKeys),
    hidden: false,
  }),
  key: await enc(rawSend),
  created_at: stamp,
  updated_at: stamp,
  deletion_date: 4102444800,
});
process.stdout.write(JSON.stringify(rows, null, 2));
