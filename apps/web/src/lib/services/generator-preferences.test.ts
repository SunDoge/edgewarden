import { describe, expect, test } from "vitest";
import {
  createGeneratorPreferences,
  parseGeneratorPreferences,
} from "./generator-preferences";

describe("generator preferences", () => {
  test("uses stable defaults for absent or malformed storage", () => {
    expect(parseGeneratorPreferences(null)).toEqual(
      createGeneratorPreferences(),
    );
    expect(parseGeneratorPreferences("{")).toEqual(
      createGeneratorPreferences(),
    );
  });

  test("restores known values without accepting incompatible field types", () => {
    const preferences = parseGeneratorPreferences(
      JSON.stringify({ mode: "pin", pinLength: 12, length: "unsafe" }),
    );
    expect(preferences.mode).toBe("pin");
    expect(preferences.pinLength).toBe(12);
    expect(preferences.length).toBe(20);
  });

  test("rejects invalid union values", () => {
    const preferences = parseGeneratorPreferences(
      JSON.stringify({
        mode: "unknown",
        aliasMode: "relay",
        sshType: "dsa",
        rsaLength: "1024",
      }),
    );
    expect(preferences.mode).toBe("password");
    expect(preferences.aliasMode).toBe("plus");
    expect(preferences.sshType).toBe("ed25519");
    expect(preferences.rsaLength).toBe("3072");
  });
});
