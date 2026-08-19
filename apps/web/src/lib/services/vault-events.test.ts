import { describe, expect, it, vi } from "vitest";
import { createVaultEventBus, type VaultEvent } from "./vault-events";

function fakeChannel() {
  let listener: ((event: MessageEvent) => void) | null = null;
  return {
    channel: {
      postMessage: vi.fn(),
      addEventListener: vi.fn((_type: string, next: EventListener) => {
        listener = next as (event: MessageEvent) => void;
      }),
      removeEventListener: vi.fn(),
    } as unknown as BroadcastChannel,
    deliver(sourceId: string, event: VaultEvent) {
      listener?.(new MessageEvent("message", { data: { sourceId, event } }));
    },
  };
}

describe("vault cross-tab events", () => {
  it("broadcasts typed events and ignores messages from the same tab", () => {
    const fake = fakeChannel();
    const bus = createVaultEventBus(fake.channel, "current-tab");
    const received = vi.fn();
    bus.subscribe(received);

    bus.broadcast({ type: "locked" });
    expect(fake.channel.postMessage).toHaveBeenCalledWith({
      sourceId: "current-tab",
      event: { type: "locked" },
    });
    fake.deliver("current-tab", { type: "logged-out" });
    expect(received).not.toHaveBeenCalled();
    fake.deliver("another-tab", {
      type: "snapshot-updated",
      accountId: "account-id",
    });
    expect(received).toHaveBeenCalledWith({
      type: "snapshot-updated",
      accountId: "account-id",
    });
  });
});
