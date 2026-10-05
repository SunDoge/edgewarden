import { describe, expect, it } from "vitest";
import { parseDeviceTypeHeader } from "./device-type";

describe("auth request device type", () => {
  it("accepts the numeric and named forms parsed by Bitwarden", () => {
    expect(parseDeviceTypeHeader("1")).toBe(1);
    expect(parseDeviceTypeHeader("iOS")).toBe(1);
    expect(parseDeviceTypeHeader("SafariExtension")).toBe(20);
  });

  it("rejects missing, malformed, and out-of-byte-range values", () => {
    expect(parseDeviceTypeHeader(undefined)).toBeNull();
    expect(parseDeviceTypeHeader(" ")).toBeNull();
    expect(parseDeviceTypeHeader("1.5")).toBeNull();
    expect(parseDeviceTypeHeader("256")).toBeNull();
    expect(parseDeviceTypeHeader("NotADevice")).toBeNull();
  });
});
