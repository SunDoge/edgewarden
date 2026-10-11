// @vitest-environment jsdom
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { renderComponent, screen } from "$lib/../test/component";
import { changeLocale } from "./locale.svelte";
import { getLocale, localStorageKey } from "$lib/paraglide/runtime.js";
import LocaleFixture from "./LocaleFixture.svelte";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  });
  changeLocale("en");
});
afterEach(() => vi.unstubAllGlobals());

test("switches messages without replacing the form or losing input", async () => {
  const { user } = renderComponent(LocaleFixture, {});
  const input = screen.getByRole("textbox", { name: "Email address" });
  await user.type(input, "draft@example.com");
  await user.click(screen.getByRole("button", { name: "Switch language" }));
  expect(screen.getByRole("textbox", { name: "电子邮件地址" })).toBe(input);
  expect(input).toHaveValue("draft@example.com");
  expect(localStorage.getItem(localStorageKey)).toBe("zh-CN");
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(document.documentElement.dir).toBe("ltr");
  await user.click(screen.getByRole("button", { name: "切换语言" }));
  expect(screen.getByRole("textbox", { name: "Email address" })).toBe(input);
  expect(localStorage.getItem(localStorageKey)).toBe("en");
});

test("ignores unsupported locales", () => {
  changeLocale("unknown");
  expect(getLocale()).toBe("en");
  expect(document.documentElement.lang).toBe("en");
});

test("still switches when preference storage is blocked", () => {
  vi.mocked(localStorage.setItem).mockImplementation(() => {
    throw new DOMException("Storage blocked", "SecurityError");
  });
  changeLocale("zh-CN");
  expect(getLocale()).toBe("zh-CN");
  expect(document.documentElement.lang).toBe("zh-CN");
});
