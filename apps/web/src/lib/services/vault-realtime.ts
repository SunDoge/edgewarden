export interface VaultRealtimeClientOptions {
  getTicket: () => Promise<string>;
  onRevision: (revision: number) => Promise<void> | void;
  origin?: string;
  createSocket?: (url: string) => WebSocket;
  reconnectDelayMs?: number;
}

export class VaultRealtimeClient {
  readonly #getTicket: () => Promise<string>;
  readonly #onRevision: (revision: number) => Promise<void> | void;
  readonly #origin: string;
  readonly #createSocket: (url: string) => WebSocket;
  readonly #reconnectDelayMs: number;
  #socket: WebSocket | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #stopped = true;
  #connecting = false;

  constructor(options: VaultRealtimeClientOptions) {
    this.#getTicket = options.getTicket;
    this.#onRevision = options.onRevision;
    this.#origin = options.origin ?? window.location.origin;
    this.#createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 5_000;
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    void this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#socket?.close(1000, "Client stopped");
    this.#socket = null;
  }

  async #connect(): Promise<void> {
    if (this.#stopped || this.#connecting || this.#socket) return;
    this.#connecting = true;
    try {
      const ticket = await this.#getTicket();
      if (this.#stopped) return;
      const url = new URL("/api/notifications/hub", this.#origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", ticket);
      const socket = this.#createSocket(url.toString());
      this.#socket = socket;
      socket.addEventListener("message", (event) => {
        const message = safeParseJsonWithSchema(
          String(event.data),
          VaultRevisionMessageSchema,
        );
        if (message) void this.#onRevision(message.revisionDate);
      });
      socket.addEventListener("close", () => {
        if (this.#socket === socket) this.#socket = null;
        this.#scheduleReconnect();
      });
      socket.addEventListener("error", () => socket.close());
    } catch {
      this.#scheduleReconnect();
    } finally {
      this.#connecting = false;
    }
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#connect();
    }, this.#reconnectDelayMs);
  }
}
import { safeParseJsonWithSchema } from "@edgewarden/shared";
import * as v from "valibot";

const VaultRevisionMessageSchema = v.object({
  type: v.literal("vault-revision"),
  revisionDate: v.pipe(v.number(), v.finite()),
});
