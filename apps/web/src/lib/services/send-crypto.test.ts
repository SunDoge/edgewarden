import { describe, expect, it } from "vitest";
import { decryptBw } from "./crypto";
import {
  createSendKeys,
  decodeSendShareKey,
  decryptOwnedSend,
  decryptPublicSend,
  deriveSendPasswordHash,
  encodeSendShareKey,
  encryptSendMetadata,
  wrapSendKey,
} from "./send-crypto";

describe("Send client-side encryption", () => {
  it("matches an independently generated HKDF-SHA256 protocol vector", async () => {
    const raw = Uint8Array.from({ length: 16 }, (_, index) => index);
    const keys = await decodeSendShareKey(encodeSendShareKey(raw));
    const hex = (value: Uint8Array) =>
      Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

    expect(hex(keys.enc)).toBe(
      "063a955a1c01b4e1aacb7cd359c919b2cb61041c0c05c94c0eb76fb9a9e144b3",
    );
    expect(hex(keys.mac)).toBe(
      "fbeca074de1437a1a2330ad2833138abf3be2561a3a30ae1f33e15e1a2f7ca04",
    );
  });

  it("matches an independently generated Send password PBKDF2 vector", async () => {
    const raw = Uint8Array.from({ length: 16 }, (_, index) => index);
    await expect(
      deriveSendPasswordHash("correct horse battery staple", raw),
    ).resolves.toBe("SdScJfWXhGIJ8Nkud3CrZOHHXpS0zmxQkmXuZxddKh4=");
  });

  it("derives and round-trips the official 16-byte URL-fragment key", async () => {
    const keys = await createSendKeys();
    expect(keys.raw).toHaveLength(16);
    expect(keys.enc).toHaveLength(32);
    expect(keys.mac).toHaveLength(32);
    expect(
      (await decodeSendShareKey(encodeSendShareKey(keys.raw))).raw,
    ).toEqual(keys.raw);
    await expect(
      decodeSendShareKey(encodeSendShareKey(keys.raw.slice(1))),
    ).rejects.toThrow(/长度/);
    await expect(decodeSendShareKey("bad$key")).rejects.toThrow(/格式/);
  });

  it("keeps names, notes and text encrypted in server payloads", async () => {
    const userEnc = crypto.getRandomValues(new Uint8Array(32));
    const userMac = crypto.getRandomValues(new Uint8Array(32));
    const keys = await createSendKeys();
    const metadata = await encryptSendMetadata(
      { name: "Payroll", notes: "private note", text: "salary secret" },
      keys,
    );
    const owned = await decryptOwnedSend(
      {
        id: "s",
        type: 0,
        key: await wrapSendKey(keys, userEnc, userMac),
        ...metadata,
      },
      userEnc,
      userMac,
    );
    expect(JSON.stringify(metadata)).not.toMatch(
      /Payroll|private note|salary secret/,
    );
    expect(owned).toMatchObject({
      name: "Payroll",
      notes: "private note",
      text: { text: "salary secret" },
    });
    const publicSend = await decryptPublicSend(
      { type: 0, name: metadata.name, text: metadata.text },
      keys,
    );
    expect(publicSend).toMatchObject({
      name: "Payroll",
      text: "salary secret",
    });
  });

  it("encrypts file names with the Send key", async () => {
    const keys = await createSendKeys();
    const encrypted = await encryptSendMetadata({ name: "Transfer" }, keys);
    const fileName = await (await import("./crypto")).encryptBw(
      new TextEncoder().encode("tax.pdf"),
      keys.enc,
      keys.mac,
    );
    expect(
      new TextDecoder().decode(await decryptBw(fileName, keys.enc, keys.mac)),
    ).toBe("tax.pdf");
    expect(JSON.stringify({ ...encrypted, file: { fileName } })).not.toContain(
      "tax.pdf",
    );
  });
});
