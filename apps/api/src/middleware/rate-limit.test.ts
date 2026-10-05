import { describe, expect, it, vi } from "vitest";
import { checkIpRateLimit } from "./rate-limit";

describe("IP rate limiting", () => {
  it("isolates sensitive flows sharing the same client IP", async () => {
    const limit = vi.fn<
      (request: { key: string }) => Promise<{ success: boolean }>
    >(async () => ({ success: true }));
    const context = {
      req: {
        header: (name: string) =>
          name === "CF-Connecting-IP" ? "203.0.113.7" : undefined,
      },
      env: { RL_IP: { limit } },
    };

    await checkIpRateLimit(context as never, "register");
    await checkIpRateLimit(context as never, "identity");
    await checkIpRateLimit(context as never, "two-factor");
    await checkIpRateLimit(context as never, "auth-request");
    await checkIpRateLimit(context as never, "send");

    expect(limit.mock.calls.map(([request]) => request.key)).toEqual([
      "register:203.0.113.7",
      "identity:203.0.113.7",
      "two-factor:203.0.113.7",
      "auth-request:203.0.113.7",
      "send:203.0.113.7",
    ]);
  });
});
