// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/svelte";
import { renderComponent, screen } from "$lib/../test/component";
import DemoNotice from "./DemoNotice.svelte";

// Node 26 exposes an unavailable localStorage global without a backing file;
// Paraglide needs the browser storage API even in this isolated DOM test.
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

test("does not advertise a production vault as disposable", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(Response.json({ enabled: false }));
  vi.stubGlobal("fetch", fetchMock);
  renderComponent(DemoNotice, {});
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button", { name: "Demo · Read only" })).toBeNull();
});

test("shows public credentials, readonly warning, client address, and contribution links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        enabled: true,
        readOnly: true,
        email: "demo@edgewarden.example",
        password: "public-test-password",
      }),
    ),
  );
  const { user } = renderComponent(DemoNotice, {});
  const trigger = await screen.findByRole("button", {
    name: "Demo · Read only",
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("public-test-password")).toBeNull();
  await user.click(trigger);
  expect(
    await screen.findByRole("dialog", { name: "Edgewarden Demo" }),
  ).toBeVisible();
  expect(await screen.findByText(/Do not store real passwords/)).toBeVisible();
  expect(screen.getByText(window.location.origin)).toBeVisible();
  expect(screen.getByText("demo@edgewarden.example")).toBeVisible();
  expect(screen.getByText("public-test-password")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Host your own vault" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/SunDoge/edgewarden#deploy-to-cloudflare",
  );
  expect(screen.getByRole("link", { name: "Report an issue" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Contribute" })).toBeVisible();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("does not expose credentials if status loading fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  renderComponent(DemoNotice, {});
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button", { name: "Demo · Read only" })).toBeNull();
});
