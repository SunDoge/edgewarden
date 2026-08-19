export type NetworkStatus = "checking" | "online" | "offline";

export class NetworkStatusMonitor {
  readonly #probe: () => Promise<unknown>;
  readonly #onStatus: (status: NetworkStatus) => void;
  readonly #intervalMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #stopped = true;

  constructor(options: {
    probe: () => Promise<unknown>;
    onStatus: (status: NetworkStatus) => void;
    intervalMs?: number;
  }) {
    this.#probe = options.probe;
    this.#onStatus = options.onStatus;
    this.#intervalMs = options.intervalMs ?? 30_000;
  }

  async check(
    browserOnline = typeof navigator === "undefined" ||
      navigator.onLine !== false,
  ): Promise<void> {
    if (this.#running) return;
    if (!browserOnline) {
      this.#onStatus("offline");
      return;
    }
    this.#running = true;
    try {
      await this.#probe();
      this.#onStatus("online");
    } catch {
      this.#onStatus("offline");
    } finally {
      this.#running = false;
    }
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#onStatus("checking");
    void this.check();
    const schedule = () => {
      if (this.#stopped) return;
      this.#timer = setTimeout(async () => {
        await this.check();
        schedule();
      }, this.#intervalMs);
    };
    schedule();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
