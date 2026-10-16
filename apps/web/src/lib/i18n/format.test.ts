import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime } from "./format";

describe("localized formatting", () => {
  it("formats vault timestamps with the requested locale", () => {
    const value = new Date(2026, 0, 2, 9, 5);
    expect(formatTime(value, "zh-CN")).toMatch(/09:05/);
  });
  it.each(["en", "zh-CN"] as const)("formats dates in %s", (locale) => {
    const value = new Date(2026, 0, 2, 9, 5);
    expect(formatDateTime(value, locale)).toBe(
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value),
    );
    expect(formatDate(value, locale)).toBe(
      new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(value),
    );
  });
});
