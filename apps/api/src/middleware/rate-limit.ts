import type { Context } from "hono";
import type { HonoEnv } from "../env";

type HonoContext = Context<HonoEnv>;

/** IP-level rate limit — for login and other sensitive endpoints */
export async function checkIpRateLimit(c: HonoContext): Promise<boolean> {
	const ip =
		c.req.header("CF-Connecting-IP") ??
		c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
		"unknown";
	const { success } = await c.env.RL_IP.limit({ key: ip });
	return success;
}

/** Account-level rate limit — keyed on email, survives IP rotation */
export async function checkAccountRateLimit(
	c: HonoContext,
	email: string,
): Promise<boolean> {
	const { success } = await c.env.RL_ACCOUNT.limit({
		key: email.toLowerCase(),
	});
	return success;
}
