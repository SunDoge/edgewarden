import {
  createDecipheriv,
  createHmac,
  hkdfSync,
  pbkdf2Sync,
  privateDecrypt,
  createPrivateKey,
  constants,
} from "node:crypto";
import { expect, it } from "vitest";
import { DEMO_FIXTURE } from "./fixture";
import { DEMO_EMAIL, DEMO_PASSWORD } from "./policy";

// Independently verify fixture MACs and plaintext, including organization and
// Send key hierarchies; API shape tests alone cannot catch unreadable samples.
it("decrypts all public samples in English with the published credentials", () => {
  const find = (table: string) =>
    DEMO_FIXTURE.find((entry) => entry.table === table)!.row;
  const decrypt = (value: unknown, key: Buffer) => {
    const [iv, ciphertext, mac] = String(value)
      .slice(2)
      .split("|")
      .map((part) => Buffer.from(part, "base64"));
    expect(
      createHmac("sha256", key.subarray(32))
        .update(Buffer.concat([iv, ciphertext]))
        .digest(),
    ).toEqual(mac);
    const decipher = createDecipheriv("aes-256-cbc", key.subarray(0, 32), iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  };
  const master = pbkdf2Sync(DEMO_PASSWORD, DEMO_EMAIL, 600000, 32, "sha256");
  // Bitwarden stretches its master key with HKDF-Expand (not Extract).
  const stretch = (info: string) =>
    createHmac("sha256", master)
      .update(Buffer.concat([Buffer.from(info), Buffer.from([1])]))
      .digest();
  const vault = decrypt(
    find("users").key,
    Buffer.concat([stretch("enc"), stretch("mac")]),
  );
  const org = privateDecrypt(
    {
      key: createPrivateKey({
        key: decrypt(find("users").private_key, vault),
        format: "der",
        type: "pkcs8",
      }),
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha1",
    },
    Buffer.from(String(find("org_members").key).slice(2), "base64"),
  );
  const sendKey = Buffer.from(
    hkdfSync(
      "sha256",
      decrypt(find("sends").key, vault),
      "bitwarden-send",
      "send",
      64,
    ),
  );
  expect(decrypt(find("folders").name, vault).toString()).toBe("Sample vault");
  expect(find("organizations").name).toBe("Edgewarden Demo Organization");
  expect(decrypt(find("collections").name, org).toString()).toBe(
    "Team collection",
  );
  const ciphers = DEMO_FIXTURE.filter((entry) => entry.table === "ciphers");
  expect(
    ciphers.map(({ row }) =>
      decrypt(row.name, row.org_id ? org : vault).toString(),
    ),
  ).toEqual([
    "Example website",
    "Welcome to Edgewarden",
    "Sample credit card",
    "Sample identity",
    "Shared team login",
  ]);
  for (const { row } of ciphers)
    expect(decrypt(row.notes, row.org_id ? org : vault).toString()).toBe(
      "For demonstration only. These are not real credentials.",
    );
  expect(decrypt(find("sends").name, sendKey).toString()).toBe(
    "Read-only text Send",
  );
  expect(
    decrypt(JSON.parse(String(find("sends").data)).text, sendKey).toString(),
  ).toBe("Welcome to Edgewarden. All content is fictional sample data.");
});
