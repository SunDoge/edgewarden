import { EnvironmentPolicyProvider } from "./policy";
import { TunnelSession } from "./session";

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/healthz") {
			return Response.json({ status: "ok" });
		}
		if (url.pathname !== (env.WS_PATH ?? "/ws")) {
			return new Response("Not found", { status: 404 });
		}
		if (request.method !== "GET") {
			return new Response("Method not allowed", {
				status: 405,
				headers: { Allow: "GET" },
			});
		}
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return new Response("WebSocket upgrade required", { status: 426 });
		}

		const [client, server] = Object.values(new WebSocketPair());
		server.binaryType = "arraybuffer";
		server.accept({ allowHalfOpen: true });
		new TunnelSession(
			server,
			request,
			new EnvironmentPolicyProvider(env),
		).start();
		return new Response(null, { status: 101, webSocket: client });
	},
} satisfies ExportedHandler<CloudflareBindings>;
