import type { Context } from "hono";
import type { HonoEnv } from "../env";
import { errorResponse } from "../utils/response";
import { verifyPassword } from "./auth";

export async function verifyAdminPassword(
	c: Context<HonoEnv>,
	hash: string,
): Promise<Response | null> {
	const user = c.get("user");
	return (await verifyPassword(hash, user.master_password_hash, user.email))
		? null
		: errorResponse("Invalid password", 400);
}
