import { factory } from "../http/factory";
import * as usersDb from "../services/db/users";
import { createRealtimeTicket, verifyRealtimeTicket } from "../utils/jwt";
import { errorResponse } from "../utils/response";

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
	if (!ticket) return errorResponse("Realtime ticket required", 401);
	const claims = await verifyRealtimeTicket(ticket, c.env.JWT_SECRET);
	if (!claims) return errorResponse("Invalid or expired realtime ticket", 401);
	const user = await usersDb.getUserById(c.get("db"), claims.sub);
	if (
		!user ||
		user.security_stamp !== claims.sstamp ||
		user.status !== "active"
	) {
		return errorResponse("Realtime ticket is no longer valid", 401);
	}
	return c.env.REALTIME.getByName(user.id).fetch(c.req.raw);
});
