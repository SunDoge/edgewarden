import { DurableObject } from "cloudflare:workers";
import {
  encodeSignalRInvocation,
  parseSignalRHandshake,
  SIGNALR_HANDSHAKE_ACK,
  SIGNALR_RECORD_SEPARATOR,
  SIGNALR_AUTH_REQUEST,
  SIGNALR_SYNC_VAULT,
  type SignalRProtocol,
} from "../services/signalr";

type RealtimeMessage =
  | {
      type: "vault-revision";
      revisionDate: number;
      userId?: string;
    }
  | {
      type: "auth-request";
      authRequestId: string;
      userId: string;
      requestDeviceIdentifier: string;
    };

type SocketAttachment =
  | { client: "edgewarden" }
  | {
      client: "signalr";
      handshakeComplete: boolean;
      protocol: SignalRProtocol;
    };

export class VaultRealtime extends DurableObject<CloudflareBindings> {
  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        `{"type":6}${SIGNALR_RECORD_SEPARATOR}`,
        `{"type":6}${SIGNALR_RECORD_SEPARATOR}`,
      ),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const message = await request.json<RealtimeMessage>();
      const validVaultRevision =
        message.type === "vault-revision" &&
        Number.isFinite(message.revisionDate);
      const validAuthRequest =
        message.type === "auth-request" &&
        Boolean(message.authRequestId) &&
        Boolean(message.userId) &&
        Boolean(message.requestDeviceIdentifier);
      if (!validVaultRevision && !validAuthRequest) {
        return new Response("Invalid realtime message", { status: 400 });
      }
      const encoded = JSON.stringify(message);
      for (const socket of this.ctx.getWebSockets()) {
        const attachment =
          (socket.deserializeAttachment() as SocketAttachment | null) ?? null;
        try {
          if (attachment?.client === "signalr") {
            if (!attachment.handshakeComplete) continue;
            if (message.type === "vault-revision") {
              socket.send(
                encodeSignalRInvocation(
                  attachment.protocol,
                  SIGNALR_SYNC_VAULT,
                  {
                    UserId: message.userId ?? "",
                    Date: new Date(message.revisionDate * 1000).toISOString(),
                  },
                ),
              );
            } else {
              socket.send(
                encodeSignalRInvocation(
                  attachment.protocol,
                  SIGNALR_AUTH_REQUEST,
                  { UserId: message.userId, Id: message.authRequestId },
                  message.requestDeviceIdentifier,
                ),
              );
            }
          } else {
            socket.send(encoded);
          }
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
    this.ctx.acceptWebSocket(server);
    const signalR = url.searchParams.get("edgewarden_protocol") === "signalr";
    server.serializeAttachment(
      signalR
        ? ({
            client: "signalr",
            handshakeComplete: false,
            protocol: "messagepack",
          } satisfies SocketAttachment)
        : ({ client: "edgewarden" } satisfies SocketAttachment),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer | ArrayBufferView,
  ): void {
    const attachment =
      (socket.deserializeAttachment() as SocketAttachment | null) ?? null;
    if (attachment?.client !== "signalr") {
      if (message === "ping") socket.send("pong");
      return;
    }
    if (attachment.handshakeComplete) return;
    const protocol = parseSignalRHandshake(message);
    if (!protocol) {
      socket.close(1002, "Invalid SignalR handshake");
      return;
    }
    attachment.protocol = protocol;
    attachment.handshakeComplete = true;
    socket.serializeAttachment(attachment);
    socket.send(SIGNALR_HANDSHAKE_ACK);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }
}
