// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { tick } from "svelte";
import { renderComponent, screen } from "$lib/../test/component";
import { changeLocale } from "./locale.svelte";
import OrganizationCollectionsCard from "$lib/components/organizations/OrganizationCollectionsCard.svelte";
import VaultSidebar from "$lib/components/vault/VaultSidebar.svelte";
import LoginCipherDetail from "$lib/components/vault/LoginCipherDetail.svelte";
import { cipherTypeName } from "$lib/services/vault-item-display";
import { CipherType } from "@edgewarden/shared";

beforeEach(() => changeLocale("en"));
afterEach(() => changeLocale("en"));

test("switches a real form without losing its draft or translating user data", async () => {
  const { user } = renderComponent(OrganizationCollectionsCard, {
    organization: { role: "owner", accessAll: true },
    collections: [{ id: "one", name: "用户的集合" }],
    name: "",
    busy: false,
    onadd: vi.fn(),
    onrename: vi.fn(),
    onremove: vi.fn(),
  });
  const input = screen.getByRole("textbox", { name: "New collection name" });
  await user.type(input, "Draft name");
  changeLocale("zh-CN");
  await tick();
  expect(screen.getByRole("textbox", { name: "新集合名称" })).toBe(input);
  expect(input).toHaveValue("Draft name");
  expect(screen.getByRole("button", { name: "添加集合" })).toBeEnabled();
  expect(screen.getByText("用户的集合")).toBeVisible();
  changeLocale("en");
  await tick();
  expect(screen.getByRole("button", { name: "Add collection" })).toBeEnabled();
  expect(input).toHaveValue("Draft name");
});

test("sidebar filters and type labels react to the selected language", async () => {
  const { container } = renderComponent(VaultSidebar, {
    activeCategory: "all",
    activeFolder: null,
    duplicateCount: 0,
    duplicateFolderCount: 0,
    mergingDuplicateFolders: false,
    onCreate: vi.fn(),
    onCreateFolder: vi.fn(),
    onRenameFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onDeleteAllFolders: vi.fn(),
    onMergeDuplicateFolders: vi.fn(),
  });
  expect(container.textContent).not.toMatch(/\p{Script=Han}/u);
  expect(screen.getByRole("button", { name: "Login" })).toBeVisible();
  expect(cipherTypeName(CipherType.Login)).toBe("Login");
  changeLocale("zh-CN");
  await tick();
  expect(screen.getByRole("button", { name: "登录凭据" })).toBeVisible();
  expect(cipherTypeName(CipherType.Login)).toBe("登录凭据");
  changeLocale("en");
  await tick();
  expect(container.textContent).not.toMatch(/\p{Script=Han}/u);
});

test("login details localize labels without changing the stored credentials", async () => {
  const { user } = renderComponent(LoginCipherDetail, {
    login: {
      username: "用户@example.com",
      password: "private-test-password",
      uris: [],
    },
    totp: null,
    hidePasswords: false,
  });
  await user.click(screen.getByRole("button", { name: "Show password" }));
  changeLocale("zh-CN");
  await tick();
  expect(screen.getByRole("button", { name: "隐藏密码" })).toBeVisible();
  expect(screen.getByText("private-test-password")).toBeVisible();
  expect(screen.getByText("用户@example.com")).toBeVisible();
});
