import { describe, expect, it } from "vitest";
import { computeSshFingerprint, generateSshKey } from "./ssh-key-generator";

describe("SSH key generator", () => {
  it("creates a self-consistent OpenSSH Ed25519 key entirely in Web Crypto", async () => {
    const key = await generateSshKey({
      type: "ed25519",
      rsaLength: 2048,
      comment: "test@example.com\nignored",
    });
    expect(key.type).toBe("ED25519");
    expect(key.publicKey).toMatch(
      /^ssh-ed25519 [A-Za-z0-9+/]+=* test@example\.com ignored$/,
    );
    expect(key.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
    expect(key.privateKey).toContain("\n-----END OPENSSH PRIVATE KEY-----\n");
    expect(await computeSshFingerprint(key.publicKey)).toBe(key.fingerprint);
  });

  it("rejects malformed public keys when fingerprinting", async () => {
    await expect(computeSshFingerprint("not-a-key")).rejects.toThrow(
      "格式无效",
    );
  });
});
