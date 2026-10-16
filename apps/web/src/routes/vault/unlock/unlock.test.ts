// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/svelte";
import { renderComponent, screen } from "$lib/../test/component";
import UnlockPage from "./+page.svelte";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  unlock: vi.fn(),
  goto: vi.fn(),
}));
vi.mock("$app/navigation", () => ({ goto: mocks.goto }));
vi.mock("$lib/services/api-auth", () => ({ isLoggedIn: () => true }));
vi.mock("$lib/services/vault-db", () => ({
  loadVaultSnapshot: mocks.snapshot,
}));
vi.mock("$lib/stores/vault.svelte", () => ({
  vault: { isUnlocked: false },
  unlock: mocks.unlock,
}));

const demo = {
  enabled: true,
  readOnly: true,
  email: "demo@edgewarden.example",
  password: "public-demo-password",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.snapshot.mockResolvedValue({ profile: { email: demo.email } });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(demo)));
});
afterEach(() => vi.unstubAllGlobals());

test("prefills the matching Demo vault but waits for explicit unlock", async () => {
  const { user } = renderComponent(UnlockPage, {});
  const input = await screen.findByLabelText("Master password");
  await waitFor(() => expect(input).toHaveValue(demo.password));
  expect(mocks.unlock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Unlock vault" }));
  await waitFor(() => expect(mocks.unlock).toHaveBeenCalledWith(demo.password));
});

test.each(["production", "other-account", "offline"])(
  "keeps manual unlock available for %s",
  async (scenario) => {
    if (scenario === "production")
      vi.mocked(fetch).mockResolvedValue(Response.json({ enabled: false }));
    if (scenario === "other-account")
      mocks.snapshot.mockResolvedValue({
        profile: { email: "other@example.com" },
      });
    if (scenario === "offline")
      vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    renderComponent(UnlockPage, {});
    const input = await screen.findByLabelText("Master password");
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(input).toHaveValue("");
    expect(mocks.unlock).not.toHaveBeenCalled();
  },
);

test("a late Demo response does not overwrite user input", async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { user } = renderComponent(UnlockPage, {});
  const input = await screen.findByLabelText("Master password");
  await user.type(input, "my-input");
  resolve(Response.json(demo));
  await waitFor(() => expect(input).toHaveValue("my-input"));
  expect(mocks.unlock).not.toHaveBeenCalled();
});

test("navigation cancels pending Demo discovery", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(fetch).mockImplementation((_url, options) => {
    signal = options?.signal ?? undefined;
    return new Promise(() => {});
  });
  const { unmount } = renderComponent(UnlockPage, {});
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  unmount();
  expect(signal?.aborted).toBe(true);
});
