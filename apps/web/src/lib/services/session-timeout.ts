export interface SessionTimeoutOptions {
  timeoutMs: number;
  onTimeout: () => void | Promise<void>;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

/** Resets a single inactivity timer without retaining any secret material. */
export class SessionTimeout {
  readonly #timeoutMs: number;
  readonly #onTimeout: () => void | Promise<void>;
  readonly #setTimer: typeof setTimeout;
  readonly #clearTimer: typeof clearTimeout;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #firing = false;

  constructor(options: SessionTimeoutOptions) {
    this.#timeoutMs = options.timeoutMs;
    this.#onTimeout = options.onTimeout;
    this.#setTimer = options.setTimer ?? setTimeout;
    this.#clearTimer = options.clearTimer ?? clearTimeout;
  }

  reset(): void {
    if (this.#timer) this.#clearTimer(this.#timer);
    if (this.#timeoutMs <= 0 || this.#firing) return;
    this.#timer = this.#setTimer(() => {
      this.#timer = null;
      this.#firing = true;
      void Promise.resolve(this.#onTimeout()).finally(() => {
        this.#firing = false;
      });
    }, this.#timeoutMs);
  }

  stop(): void {
    if (this.#timer) this.#clearTimer(this.#timer);
    this.#timer = null;
  }
}
