import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionTimeout } from "./session-timeout";

describe("session timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("invokes browser host timers with their global receiver", () => {
    const setTimer = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
      return 123;
    });
    const clearTimer = vi.fn(function (this: unknown) {
      expect(this).toBe(globalThis);
    });
    vi.stubGlobal("setTimeout", setTimer);
    vi.stubGlobal("clearTimeout", clearTimer);
    const timeout = new SessionTimeout({ timeoutMs: 1000, onTimeout: vi.fn() });
    timeout.reset();
    timeout.stop();
    expect(setTimer).toHaveBeenCalledOnce();
    expect(clearTimer).toHaveBeenCalledWith(123);
  });

  it("fires after inactivity and resets on activity", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const timeout = new SessionTimeout({ timeoutMs: 1_000, onTimeout });
    timeout.reset();
    await vi.advanceTimersByTimeAsync(900);
    timeout.reset();
    await vi.advanceTimersByTimeAsync(900);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it("does not arm a timer when disabled", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    new SessionTimeout({ timeoutMs: 0, onTimeout }).reset();
    await vi.runAllTimersAsync();
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
