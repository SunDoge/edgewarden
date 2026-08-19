import { describe, expect, it } from "vitest";
import { formatFileSize } from "./backup-display";

describe("formatFileSize", () => {
  it.each([
    [null, "--"],
    [undefined, "--"],
    [-1, "--"],
    [0, "0 Bytes"],
    [512, "512 Bytes"],
    [1536, "1.5 KB"],
    [5 * 1024 * 1024, "5 MB"],
  ])("formats %s bytes as %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});
