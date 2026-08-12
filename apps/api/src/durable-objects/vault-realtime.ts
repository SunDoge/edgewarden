type VaultChangeMessage = {
	type: "vault-revision";
	revisionDate: number;
};

export class VaultRealtime {
	constructor(private readonly state: DurableObjectState) {
		this.state.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong"),
		);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "POST" && url.pathname === "/broadcast") {
			const message = await request.json<VaultChangeMessage>();
			if (
				message.type !== "vault-revision" ||
				!Number.isFinite(message.revisionDate)
			) {
				return new Response("Invalid realtime message", { status: 400 });
			}
			const encoded = JSON.stringify(message);
			for (const socket of this.state.getWebSockets()) {
				try {
					socket.send(encoded);
				} catch {
					socket.close(1011, "Broadcast failed");
				}
			}
			return new Response(null, { status: 204 });
		}

		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return new Response("WebSocket upgrade required", { status: 426 });
		}
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.state.acceptWebSocket(server);
		return new Response(null, { status: 101, webSocket: client });
	}

	webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
		if (message === "ping") socket.send("pong");
	}

	webSocketClose(socket: WebSocket, code: number, reason: string): void {
		socket.close(code, reason);
	}
}
