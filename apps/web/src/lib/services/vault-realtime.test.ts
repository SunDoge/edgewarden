import { describe, expect, it, vi } from "vitest";
import { VaultRealtimeClient } from "./vault-realtime";

class FakeSocket extends EventTarget {
  closed = false;
  close(): void {
    this.closed = true;
    this.dispatchEvent(new Event("close"));
  }
  message(value: unknown): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
}

describe("vault realtime client", () => {
  it("uses a short-lived ticket and forwards revision events", async () => {
    const socket = new FakeSocket();
    const onRevision = vi.fn();
    const createSocket = vi.fn(
      (_url: string) => socket as unknown as WebSocket,
    );
    const client = new VaultRealtimeClient({
      origin: "https://vault.example.test",
      getTicket: async () => "short-lived-ticket",
      onRevision,
      createSocket,
    });
    client.start();
    await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
    expect(createSocket.mock.calls[0]?.[0]).toBe(
      "wss://vault.example.test/api/notifications/hub?ticket=short-lived-ticket",
    );
    socket.message({ type: "vault-revision", revisionDate: 1234 });
    socket.message({ type: "unrelated", revisionDate: 5678 });
    expect(onRevision).toHaveBeenCalledExactlyOnceWith(1234);
    client.stop();
    expect(socket.closed).toBe(true);
  });

  it("reconnects after a connection failure and stops retrying after disposal", async () => {
    vi.useFakeTimers();
    const getTicket = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("next-ticket");
    const socket = new FakeSocket();
    const createSocket = vi.fn(
      (_url: string) => socket as unknown as WebSocket,
    );
    const client = new VaultRealtimeClient({
      origin: "http://localhost",
      getTicket,
      onRevision: vi.fn(),
      createSocket,
      reconnectDelayMs: 100,
    });
    client.start();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(createSocket).toHaveBeenCalledOnce();
    client.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getTicket).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
