// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { warmRoutes } from "./route-preload";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("does not compete with navigation, and loads only one route at a time", async () => {
  let busy = true;
  let finish!: () => void;
  const preload = vi.fn(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  const stop = warmRoutes(["/one", "/two"], preload, () => !busy);
  await vi.advanceTimersByTimeAsync(3000);
  expect(preload).not.toHaveBeenCalled();
  busy = false;
  await vi.advanceTimersByTimeAsync(3000);
  expect(preload).toHaveBeenCalledExactlyOnceWith("/one");
  await vi.advanceTimersByTimeAsync(6000);
  expect(preload).toHaveBeenCalledOnce();
  finish();
  await vi.advanceTimersByTimeAsync(3000);
  expect(preload).toHaveBeenLastCalledWith("/two");
  stop();
  finish();
});

test("leaving the vault stops the queue even while an import is in flight", async () => {
  let finish!: () => void;
  const preload = vi.fn(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  const stop = warmRoutes(["/one", "/two"], preload, () => true);
  await vi.advanceTimersByTimeAsync(3000);
  stop();
  finish();
  await vi.advanceTimersByTimeAsync(9000);
  expect(preload).toHaveBeenCalledOnce();
});

test.each([{ saveData: true }, { effectiveType: "2g" }])(
  "does not preload on constrained connections: %j",
  async (connection) => {
    vi.stubGlobal("navigator", { connection });
    const preload = vi.fn();
    warmRoutes(["/one"], preload, () => true);
    await vi.advanceTimersByTimeAsync(9000);
    expect(preload).not.toHaveBeenCalled();
  },
);

test("defers hidden tabs and tolerates failed speculative imports", async () => {
  vi.mocked(
    Object.getOwnPropertyDescriptor(document, "visibilityState")!.get!,
  ).mockReturnValue("hidden");
  const preload = vi.fn().mockRejectedValue(new Error("offline"));
  const stop = warmRoutes(["/one", "/two"], preload, () => true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(preload).not.toHaveBeenCalled();
  vi.mocked(
    Object.getOwnPropertyDescriptor(document, "visibilityState")!.get!,
  ).mockReturnValue("visible");
  await vi.advanceTimersByTimeAsync(6000);
  expect(preload).toHaveBeenCalledTimes(2);
  stop();
});

test("cancels a queued idle callback before it can import a route", async () => {
  let runIdle!: IdleRequestCallback;
  vi.stubGlobal(
    "requestIdleCallback",
    vi.fn((callback: IdleRequestCallback) => {
      runIdle = callback;
      return 42;
    }),
  );
  const cancelIdle = vi.fn();
  vi.stubGlobal("cancelIdleCallback", cancelIdle);
  const preload = vi.fn();
  const stop = warmRoutes(["/one"], preload, () => true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(preload).not.toHaveBeenCalled();
  stop();
  expect(cancelIdle).toHaveBeenCalledWith(42);
  runIdle({ didTimeout: false, timeRemaining: () => 50 });
  expect(preload).not.toHaveBeenCalled();
});
