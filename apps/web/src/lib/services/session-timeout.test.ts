import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionTimeout } from "./session-timeout";

describe("session timeout", () => {
  afterEach(() => vi.useRealTimers());

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
