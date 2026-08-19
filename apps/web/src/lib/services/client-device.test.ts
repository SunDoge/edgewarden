import { describe, expect, it } from "vitest";
import {
  browserDeviceName,
  getCurrentDeviceIdentifier,
  getOrCreateDeviceIdentifier,
} from "./client-device";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("client device identity", () => {
  it("creates one stable identifier without rotating it between sessions", () => {
    const storage = memoryStorage();
    expect(getOrCreateDeviceIdentifier(storage, () => "device-one")).toBe(
      "device-one",
    );
    expect(getOrCreateDeviceIdentifier(storage, () => "device-two")).toBe(
      "device-one",
    );
    expect(getCurrentDeviceIdentifier(storage)).toBe("device-one");
  });

  it("uses a non-sensitive browser and platform label", () => {
    expect(
      browserDeviceName("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0"),
    ).toBe("Chrome on Windows");
    expect(
      browserDeviceName("Mozilla/5.0 (iPhone) Version/18.0 Safari/605.1"),
    ).toBe("Safari on iOS");
  });
});
