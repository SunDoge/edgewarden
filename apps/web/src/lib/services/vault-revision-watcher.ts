export interface VaultRevisionWatcherOptions {
	readRevision: () => Promise<number>;
	onRevision: (revision: number) => Promise<void> | void;
	intervalMs?: number;
}

export class VaultRevisionWatcher {
	readonly #readRevision: () => Promise<number>;
	readonly #onRevision: (revision: number) => Promise<void> | void;
	readonly #intervalMs: number;
	#lastRevision: number | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;
	#checking = false;
	#stopped = true;

	constructor(options: VaultRevisionWatcherOptions) {
		this.#readRevision = options.readRevision;
		this.#onRevision = options.onRevision;
		this.#intervalMs = options.intervalMs ?? 30_000;
	}

	async check(): Promise<void> {
		if (this.#checking) return;
		this.#checking = true;
		try {
			const revision = await this.#readRevision();
			if (!Number.isFinite(revision)) return;
			if (this.#lastRevision === null) this.#lastRevision = revision;
			else if (revision !== this.#lastRevision) {
				this.#lastRevision = revision;
				await this.#onRevision(revision);
			}
		} catch {
			// Network failures are expected while offline; the next interval retries.
		} finally {
			this.#checking = false;
		}
	}

	start(): void {
		if (!this.#stopped) return;
		this.#stopped = false;
		void this.check();
		this.#timer = setInterval(() => void this.check(), this.#intervalMs);
	}

	stop(): void {
		this.#stopped = true;
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}
}
