import { connect } from "cloudflare:sockets";
import {
	credentialMatches,
	type PolicyProvider,
	type TunnelCredential,
	type TunnelPolicySnapshot,
} from "./policy";
import {
	isPublicDestination,
	parseVlessRequest,
	toUint8Array,
	VlessProtocolError,
} from "./vless";

const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_TOO_LARGE = 1009;
const CLOSE_INTERNAL_ERROR = 1011;

export class TunnelSession {
	private policy: TunnelPolicySnapshot | null = null;
	private socket: Socket | null = null;
	private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
	private pendingBytes = 0;
	private inbound = Promise.resolve();
	private closed = false;

	constructor(
		private readonly websocket: WebSocket,
		private readonly request: Request,
		private readonly policyProvider: PolicyProvider,
	) {}

	start(): void {
		this.websocket.addEventListener("message", (event) => {
			const frame = binaryFrame(event.data);
			const size = frame?.byteLength ?? null;
			const frameLimit = this.policy?.maxFrameBytes ?? 1024 * 1024;
			const pendingLimit = this.policy?.maxPendingBytes ?? 2 * 1024 * 1024;
			if (!frame || size === null) {
				this.close(CLOSE_POLICY_VIOLATION, "binary frames required");
				return;
			}
			if (size > frameLimit) {
				this.close(CLOSE_TOO_LARGE, "frame limit exceeded");
				return;
			}
			if (this.pendingBytes + size > pendingLimit) {
				this.close(CLOSE_POLICY_VIOLATION, "write queue limit exceeded");
				return;
			}

			this.pendingBytes += size;
			this.inbound = this.inbound
				.then(() => this.handleFrame(frame))
				.catch((error: unknown) => this.handleError(error))
				.finally(() => {
					this.pendingBytes -= size;
				});
		});
		this.websocket.addEventListener("close", () => this.closeSocket());
		this.websocket.addEventListener("error", () => this.closeSocket());
	}

	private async handleFrame(
		frame: ArrayBuffer | ArrayBufferView,
	): Promise<void> {
		if (this.closed) return;
		if (this.writer) {
			await this.writer.write(toUint8Array(frame));
			return;
		}

		const request = parseVlessRequest(frame);
		const policy = await this.policyProvider.load(this.request);
		this.policy = policy;
		if (frame.byteLength > policy.maxFrameBytes) {
			throw new VlessProtocolError("frame limit exceeded");
		}
		if (frame.byteLength > policy.maxPendingBytes) {
			throw new VlessProtocolError("write queue limit exceeded");
		}
		let credential: TunnelCredential | null = null;
		for (const candidate of policy.credentials) {
			if (credentialMatches(request.userId, candidate)) credential = candidate;
		}
		if (!credential) throw new VlessProtocolError("authentication failed");
		if (!policy.allowedPorts.has(request.port)) {
			throw new VlessProtocolError("destination port is not allowed");
		}
		if (!isPublicDestination(request.hostname)) {
			throw new VlessProtocolError("destination is not public");
		}

		const socket = connect({ hostname: request.hostname, port: request.port });
		this.socket = socket;
		this.writer = socket.writable.getWriter();
		if (request.payload.byteLength > 0) {
			await this.writer.write(request.payload);
		}
		await withTimeout(socket.opened, policy.connectTimeoutMs);
		if (this.closed) return;
		this.websocket.send(new Uint8Array([request.version, 0]));
		void this.pumpDownstream(socket);
	}

	private async pumpDownstream(socket: Socket): Promise<void> {
		try {
			const reader = socket.readable.getReader();
			try {
				while (!this.closed) {
					const { value, done } = await reader.read();
					if (done) break;
					if (value.byteLength > 0) this.websocket.send(value);
				}
			} finally {
				reader.releaseLock();
			}
			this.close(1000, "upstream closed");
		} catch (error) {
			this.handleError(error);
		}
	}

	private handleError(error: unknown): void {
		if (error instanceof VlessProtocolError) {
			this.close(CLOSE_POLICY_VIOLATION, error.message);
			return;
		}
		console.error(
			JSON.stringify({
				event: "tunnel.session.error",
				requestId: this.request.headers.get("cf-ray") ?? crypto.randomUUID(),
				error: error instanceof Error ? error.message : String(error),
			}),
		);
		this.close(CLOSE_INTERNAL_ERROR, "upstream failure");
	}

	private close(code: number, reason: string): void {
		if (this.closed) return;
		this.closed = true;
		try {
			this.websocket.close(code, reason.slice(0, 123));
		} finally {
			this.closeSocket();
		}
	}

	private closeSocket(): void {
		if (!this.closed) this.closed = true;
		if (this.writer) {
			void this.writer.close().catch(() => undefined);
			this.writer = null;
		}
		if (this.socket) {
			void this.socket.close().catch(() => undefined);
			this.socket = null;
		}
	}
}

function binaryFrame(data: unknown): ArrayBuffer | ArrayBufferView | null {
	if (data instanceof ArrayBuffer) return data;
	return ArrayBuffer.isView(data) ? data : null;
}

async function withTimeout<T>(
	promise: Promise<T>,
	milliseconds: number,
): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timeout = setTimeout(
					() => reject(new Error("upstream connection timed out")),
					milliseconds,
				);
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}
