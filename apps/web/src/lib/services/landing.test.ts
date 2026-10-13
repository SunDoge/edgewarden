import { afterEach, expect, test, vi } from "vitest";
import { loadLandingSettings } from "./landing";

afterEach(() => vi.unstubAllGlobals());

test.each([
  [{ enabled: true, readOnly: true }, "", true, true],
  [{ enabled: false }, "", false, false],
  [{ enabled: true, readOnly: false }, "", false, false],
  [null, "", false, false],
  [{ enabled: false }, "true", true, false],
  [{ enabled: true, readOnly: true }, "false", false, false],
])(
  "resolves landing settings for %j with override %s",
  async (status, override, enabled, demo) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(status)));
    expect(
      await loadLandingSettings(new AbortController().signal, override),
    ).toEqual({ enabled, demo });
    if (override === "false") expect(fetch).not.toHaveBeenCalled();
  },
);

test.each(["", "true"])(
  "handles discovery failure with override %s",
  async (override) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(
      await loadLandingSettings(new AbortController().signal, override),
    ).toEqual({ enabled: override === "true", demo: false });
  },
);

test("does not trust a failed HTTP response", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ enabled: true, readOnly: true }, { status: 500 }),
      ),
  );
  expect(await loadLandingSettings(new AbortController().signal, "")).toEqual({
    enabled: false,
    demo: false,
  });
});
