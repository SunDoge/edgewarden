import type { Context } from "hono";
import type { HonoEnv } from "../env";
import { factory } from "../http/factory";
import { verifyAccessToken } from "../services/auth";
import * as usersDb from "../services/db/users";
import { createRealtimeTicket, verifyRealtimeTicket } from "../utils/jwt";
import { errorResponse } from "../utils/response";

function accessToken(c: Context<HonoEnv>): string | null {
	const query = c.req.query("access_token")?.trim();
	if (query) return query;
	const authorization = c.req.header("Authorization")?.trim() ?? "";
	return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

async function authenticateSignalR(c: Context<HonoEnv>) {
	const token = accessToken(c);
	return token
		? verifyAccessToken(`Bearer ${token}`, c.get("db"), c.env.JWT_SECRET)
		: null;
}

export const negotiateRealtime = factory.createHandlers(async (c) => {
	const authenticated = await authenticateSignalR(c);
	if (!authenticated) return errorResponse("Unauthorized", 401);
	const connectionId = crypto.randomUUID();
	return c.json({
		connectionId,
		connectionToken: connectionId,
		negotiateVersion: 1,
		availableTransports: [
			{ transport: "WebSockets", transferFormats: ["Text", "Binary"] },
		],
	});
});

export const createRealtimeConnectionTicket = factory.createHandlers(
	async (c) => {
		const user = c.get("user");
		const token = await createRealtimeTicket(
			user.id,
			user.security_stamp,
			c.env.JWT_SECRET,
		);
		return c.json({ token, expiresIn: 60, object: "realtimeTicket" });
	},
);

export const connectRealtime = factory.createHandlers(async (c) => {
	if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
		return errorResponse("WebSocket upgrade required", 426);
	}
	const ticket = c.req.query("ticket");
	const authenticated = ticket
		? await verifyRealtimeTicket(ticket, c.env.JWT_SECRET).then(
				async (claims) => {
					if (!claims) return null;
					const user = await usersDb.getUserById(c.get("db"), claims.sub);
					return user?.security_stamp === claims.sstamp
						? ({ user, protocol: "native" } as const)
						: null;
				},
			)
		: await authenticateSignalR(c).then((result) =>
				result ? ({ user: result.user, protocol: "signalr" } as const) : null,
			);
	if (!authenticated) return errorResponse("Invalid realtime credentials", 401);
	const { user, protocol } = authenticated;
	if (user?.status !== "active") {
		return errorResponse("Realtime ticket is no longer valid", 401);
	}
	const forwarded = new URL(c.req.url);
	forwarded.searchParams.delete("access_token");
	forwarded.searchParams.delete("ticket");
	forwarded.searchParams.set("edgewarden_protocol", protocol);
	return c.env.REALTIME.getByName(user.id).fetch(
		new Request(forwarded, c.req.raw),
	);
});
