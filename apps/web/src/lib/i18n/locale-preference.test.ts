// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

test.each([
  [null, "en"],
  ["zh-CN", "zh-CN"],
  ["en", "en"],
  ["unsupported", "en"],
])(
  "restores saved preference %s as %s after hydration",
  async (saved, expected) => {
    vi.resetModules();
    vi.stubGlobal("localStorage", { getItem: () => saved, setItem: vi.fn() });
    const { restoreLocalePreference } = await import("./locale.svelte");
    const { getLocale } = await import("$lib/paraglide/runtime.js");
    expect(getLocale()).toBe("en");
    restoreLocalePreference();
    expect(getLocale()).toBe(expected);
  },
);

test("defaults to English if reading storage is blocked", async () => {
  vi.resetModules();
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new DOMException("Storage blocked", "SecurityError");
    },
  });
  await import("./locale.svelte");
  const { getLocale } = await import("$lib/paraglide/runtime.js");
  expect(getLocale()).toBe("en");
});
