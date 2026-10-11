import { afterEach, expect, test, vi } from "vitest";
import { prefillDemoLogin } from "./demo-login";

afterEach(() => vi.unstubAllGlobals());
const credentials = {
  email: "demo@edgewarden.example",
  password: "public-password",
};
const demo = { enabled: true, readOnly: true, ...credentials };

test("fills public credentials only after readonly Demo confirmation", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json(demo));
  vi.stubGlobal("fetch", fetchMock);
  const fill = vi.fn();
  await prefillDemoLogin(() => true, fill, new AbortController().signal);
  expect(fill).toHaveBeenCalledExactlyOnceWith(credentials);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    "/api/demo",
    expect.objectContaining({ cache: "no-store" }),
  );
});

test.each([
  { enabled: false },
  { ...demo, readOnly: false },
  { ...demo, email: "invalid" },
  { ...demo, password: "" },
  null,
])("never fills production or malformed responses: %j", async (payload) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
  const fill = vi.fn();
  await prefillDemoLogin(() => true, fill, new AbortController().signal);
  expect(fill).not.toHaveBeenCalled();
});

test("does not overwrite input made while discovery is pending", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  let untouched = true;
  const fill = vi.fn();
  const pending = prefillDemoLogin(
    () => untouched,
    fill,
    new AbortController().signal,
  );
  untouched = false;
  resolve(Response.json(demo));
  await pending;
  expect(fill).not.toHaveBeenCalled();
});

test("does not fill after navigation or failed discovery", async () => {
  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(demo)));
  const fill = vi.fn();
  await prefillDemoLogin(() => true, fill, controller.signal);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await prefillDemoLogin(() => true, fill, new AbortController().signal);
  expect(fill).not.toHaveBeenCalled();
});
