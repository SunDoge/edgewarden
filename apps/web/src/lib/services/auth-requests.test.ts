import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, toBufferSource } from "./crypto";
import {
  decryptApprovedVaultKey,
  encryptVaultKeyForAuthRequest,
  normalizeAuthRequest,
  publicKeyFingerprintPhrase,
} from "./auth-requests";

describe("auth request cryptography", () => {
  it("encrypts exactly the current 64-byte vault key for the requester", async () => {
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
    const spki = new Uint8Array(
      await crypto.subtle.exportKey("spki", pair.publicKey),
    );
    const enc = crypto.getRandomValues(new Uint8Array(32));
    const mac = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await encryptVaultKeyForAuthRequest(
      bytesToBase64(spki),
      enc,
      mac,
    );
    expect(wrapped.startsWith("4.")).toBe(true);
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        pair.privateKey,
        toBufferSource(base64ToBytes(wrapped.slice(2))),
      ),
    );
    expect(decrypted.slice(0, 32)).toEqual(enc);
    expect(decrypted.slice(32)).toEqual(mac);

    const unwrapped = await decryptApprovedVaultKey(wrapped, pair.privateKey);
    expect(unwrapped.encKey).toEqual(enc);
    expect(unwrapped.macKey).toEqual(mac);
  });

  it("rejects malformed approval key envelopes", async () => {
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
    await expect(
      decryptApprovedVaultKey("2.AQID", pair.privateKey),
    ).rejects.toThrow("缺少有效");

    const shortEnvelope = `4.${bytesToBase64(
      new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "RSA-OAEP" },
          pair.publicKey,
          toBufferSource(new Uint8Array(32)),
        ),
      ),
    )}`;
    await expect(
      decryptApprovedVaultKey(shortEnvelope, pair.privateKey),
    ).rejects.toThrow("长度无效");
  });

  it("produces a stable account-bound public-key fingerprint", async () => {
    const publicKey = bytesToBase64(crypto.getRandomValues(new Uint8Array(64)));
    const first = await publicKeyFingerprintPhrase(
      "User@Example.com",
      publicKey,
    );
    expect(
      await publicKeyFingerprintPhrase("user@example.com", publicKey),
    ).toBe(first);
    expect(first).toMatch(/^[a-z]+(?:-[a-z]+){4}$/);
    expect(
      await publicKeyFingerprintPhrase("other@example.com", publicKey),
    ).not.toBe(first);
  });

  it("matches the Bitwarden SDK fingerprint vector", async () => {
    const publicKey =
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvyLRDUwXB4BfQ507D4meFPmwn5zwy3IqTPJO4plrrhnclWahXa240BzyFW9gHgYu+Jrgms5xBfRTBMcEsqqNm7+JpB6C1B6yvnik0DpJgWQw1rwvy4SUYidpR/AWbQi47n/hvnmzI/sQxGddVfvWu1iTKOlf5blbKYAXnUE5DZBGnrWfacNXwRRdtP06tFB0LwDgw+91CeLSJ9py6dm1qX5JIxoO8StJOQl65goLCdrTWlox+0Jh4xFUfCkb+s3px+OhSCzJbvG/hlrSRcUz5GnwlCEyF3v5lfUtV96MJD+78d8pmH6CfFAp2wxKRAbGdk+JccJYO6y6oIXd3Fm7twIDAQAB";
    await expect(
      publicKeyFingerprintPhrase("test@bitwarden.com", publicKey),
    ).resolves.toBe("childless-unfair-prowler-dropbox-designate");
  });

  it("rejects malformed or incorrectly sized key material", async () => {
    await expect(
      encryptVaultKeyForAuthRequest(
        "bad",
        new Uint8Array(31),
        new Uint8Array(32),
      ),
    ).rejects.toThrow("保险库密钥无效");
  });
});

describe("auth request response normalization", () => {
  it("keeps the server device type name and numeric value separate", () => {
    const request = normalizeAuthRequest({
      id: "request-id",
      requestDeviceIdentifier: "device-id",
      requestDeviceTypeValue: 1,
      requestDeviceType: "iOS",
    });

    expect(request.requestDeviceTypeValue).toBe(1);
    expect(request.requestDeviceType).toBe("iOS");
    expect(request.approved).toBeNull();
  });

  it("never produces NaN for malformed or legacy device types", () => {
    const malformed = normalizeAuthRequest({ requestDeviceType: "iOS" });
    const legacy = normalizeAuthRequest({ requestDeviceType: 6 });

    expect(malformed.requestDeviceTypeValue).toBe(14);
    expect(malformed.requestDeviceType).toBe("iOS");
    expect(legacy.requestDeviceTypeValue).toBe(6);
    expect(legacy.requestDeviceType).toBe("Device type 6");
  });

  it("reads the canonical requestApproved response field", () => {
    expect(normalizeAuthRequest({ requestApproved: true }).approved).toBe(true);
    expect(normalizeAuthRequest({ requestApproved: false }).approved).toBe(
      false,
    );
  });
});
