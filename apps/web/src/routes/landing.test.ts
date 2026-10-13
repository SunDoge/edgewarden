// @vitest-environment jsdom
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/svelte";
import { renderComponent, screen } from "$lib/../test/component";
import { changeLocale } from "$lib/i18n/locale.svelte";
import Page from "./+page.svelte";

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  restore: vi.fn(),
  loggedIn: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("$app/navigation", () => ({ goto: mocks.goto }));
vi.mock("$lib/services/api-auth", () => ({ isLoggedIn: mocks.loggedIn }));
vi.mock("$lib/services/rpc", () => ({ restoreWebSession: mocks.restore }));
vi.mock("$lib/services/landing", () => ({
  loadLandingSettings: mocks.settings,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  changeLocale("en");
  mocks.settings.mockResolvedValue({ enabled: true, demo: true });
});
afterEach(() => vi.unstubAllGlobals());

test("shows the Demo landing without restoring or navigating an existing session", async () => {
  mocks.loggedIn.mockReturnValue(true);
  const { user } = renderComponent(Page, {});
  expect(await screen.findByRole("link", { name: "Try demo" })).toHaveAttribute(
    "href",
    "/login",
  );
  expect(
    screen.getByRole("link", { name: "Host your own vault" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/SunDoge/edgewarden#deploy-to-cloudflare",
  );
  expect(screen.getByText(/Read-only demo with fictional data/)).toBeVisible();
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(mocks.goto).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Switch language" }));
  expect(screen.getByRole("link", { name: "体验 Demo" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("does not label an enabled production landing as Demo", async () => {
  mocks.settings.mockResolvedValue({ enabled: true, demo: false });
  renderComponent(Page, {});
  await screen.findByRole("heading", { level: 1 });
  expect(screen.queryByRole("link", { name: "Try demo" })).toBeNull();
  expect(screen.queryByText(/Read-only demo with fictional data/)).toBeNull();
  expect(screen.getByRole("link", { name: "Open vault" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test.each([true, false])(
  "preserves the disabled-page redirect when logged in is %s",
  async (loggedIn) => {
    mocks.settings.mockResolvedValue({ enabled: false, demo: false });
    mocks.loggedIn.mockReturnValue(loggedIn);
    renderComponent(Page, {});
    await waitFor(() =>
      expect(mocks.goto).toHaveBeenCalledWith(loggedIn ? "/vault" : "/login", {
        replaceState: true,
      }),
    );
    expect(mocks.restore).toHaveBeenCalledOnce();
  },
);

test("a failed session restore still reaches login", async () => {
  mocks.settings.mockResolvedValue({ enabled: false, demo: false });
  mocks.restore.mockRejectedValue(new Error("offline"));
  renderComponent(Page, {});
  await waitFor(() =>
    expect(mocks.goto).toHaveBeenCalledWith("/login", { replaceState: true }),
  );
});

test("does not redirect after leaving during discovery", async () => {
  let resolve!: (value: { enabled: boolean; demo: boolean }) => void;
  mocks.settings.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount } = renderComponent(Page, {});
  const signal = mocks.settings.mock.calls[0][0] as AbortSignal;
  unmount();
  resolve({ enabled: false, demo: false });
  await Promise.resolve();
  expect(signal.aborted).toBe(true);
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(mocks.goto).not.toHaveBeenCalled();
});
