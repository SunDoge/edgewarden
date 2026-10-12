// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

test.each([
  [null, "en"],
  ["zh-CN", "zh-CN"],
  ["en", "en"],
  ["unsupported", "en"],
])("initializes saved preference %s as %s", async (saved, expected) => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => saved, setItem: vi.fn() });
  await import("./locale.svelte");
  const { getLocale } = await import("$lib/paraglide/runtime.js");
  expect(getLocale()).toBe(expected);
});

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
