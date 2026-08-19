import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./crypto";
import {
  buildAccountPasskeyPrfKeySetFromPrfKey,
  unlockVaultKeyWithAccountPasskeyPrf,
} from "./passkeys";

describe("account passkey PRF key wrapping", () => {
  it("round-trips the vault key through the passkey key set", async () => {
    const prfKey = crypto.getRandomValues(new Uint8Array(64));
    const enc = crypto.getRandomValues(new Uint8Array(32));
    const mac = crypto.getRandomValues(new Uint8Array(32));
    const keySet = await buildAccountPasskeyPrfKeySetFromPrfKey(prfKey, {
      symEncKey: bytesToBase64(enc),
      symMacKey: bytesToBase64(mac),
    });
    const unlocked = await unlockVaultKeyWithAccountPasskeyPrf(prfKey, keySet);
    expect(unlocked.symEncKey).toBe(bytesToBase64(enc));
    expect(unlocked.symMacKey).toBe(bytesToBase64(mac));
  });

  it("rejects a different PRF output", async () => {
    const prfKey = crypto.getRandomValues(new Uint8Array(64));
    const keySet = await buildAccountPasskeyPrfKeySetFromPrfKey(prfKey, {
      symEncKey: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),
      symMacKey: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),
    });
    await expect(
      unlockVaultKeyWithAccountPasskeyPrf(
        crypto.getRandomValues(new Uint8Array(64)),
        keySet,
      ),
    ).rejects.toThrow();
  });
});
