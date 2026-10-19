import { describe, expect, it } from "vitest";
import {
  buildAccountKeys,
  buildUserDecryptionCompat,
  buildUserDecryptionOptions,
} from "./user-decryption";

const user = {
  email: "synthetic@example.test",
  key: "2.synthetic-wrapped-user-key",
  kdf_type: 0,
  kdf_iterations: 600_000,
  kdf_memory: null,
  kdf_parallelism: null,
  private_key: "2.synthetic-wrapped-private-key",
  public_key: "synthetic-public-key",
  master_password_salt: null,
  signed_public_key: null,
  security_state: null,
  user_key_id: null,
};

function assertUniqueAliases(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertUniqueAliases);
  } else if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(object)) {
      if (/^[A-Z]/.test(key)) {
        expect(object).not.toHaveProperty(key[0].toLowerCase() + key.slice(1));
      }
      assertUniqueAliases(child);
    }
  }
}

describe("native SDK decryption contracts", () => {
  it("emits account-key fields once, including nested object discriminators", () => {
    const keys = buildAccountKeys(user);
    assertUniqueAliases(keys);
    expect(keys).toMatchObject({
      object: "privateKeys",
      publicKeyEncryptionKeyPair: {
        object: "publicKeyEncryptionKeyPair",
        wrappedPrivateKey: user.private_key,
      },
    });
  });

  it("preserves separate token and sync contracts without case aliases", () => {
    const token = buildUserDecryptionOptions(user);
    const sync = buildUserDecryptionCompat(user);
    assertUniqueAliases(token);
    assertUniqueAliases(sync);
    expect(token).toMatchObject({
      MasterPasswordUnlock: { MasterKeyEncryptedUserKey: user.key },
    });
    expect(sync).toMatchObject({
      masterPasswordUnlock: { masterKeyEncryptedUserKey: user.key },
    });
  });
});
