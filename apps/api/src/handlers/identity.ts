import { vValidator } from "@hono/valibot-validator";
import { deleteCookie, getCookie } from "hono/cookie";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { PreloginSchema } from "../schemas/identity";
import * as refreshTokensDb from "../services/db/refresh-tokens";
import * as usersDb from "../services/db/users";
import { handleGetAccountPasskeyAssertionOptions } from "./account-passkeys";
import { webRefreshCookieName } from "./identity-token-helpers";

// POST /identity/accounts/prelogin
export const prelogin = factory.createHandlers(
	vValidator("json", PreloginSchema),
	async (c) => {
		const { email } = c.req.valid("json");
		const db = c.get("db");
		const user = await usersDb.getUserByEmail(db, email);
		const kdfType = user?.kdf_type ?? 0;
		const kdfIterations =
			user?.kdf_iterations ?? LIMITS.auth.defaultKdfIterations;
		return c.json({
			kdf: kdfType,
			kdfIterations,
			kdfMemory: user?.kdf_memory ?? null,
			kdfParallelism: user?.kdf_parallelism ?? null,
			KdfSettings: {
				KdfType: kdfType,
				Iterations: kdfIterations,
				Memory: user?.kdf_memory ?? null,
				Parallelism: user?.kdf_parallelism ?? null,
			},
			Salt: email.toLowerCase(),
		});
	},
);

export const getPasskeyAssertionOptions = factory.createHandlers(
	handleGetAccountPasskeyAssertionOptions,
);

export { connectToken } from "./identity-token";
// POST /identity/connect/revocation
// POST /identity/connect/revoke
export const revokeToken = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const token =
		c.get("revocationToken") || getCookie(c, webRefreshCookieName(c.req.url));
	if (token) await refreshTokensDb.deleteRefreshToken(db, token);
	deleteCookie(c, webRefreshCookieName(c.req.url), {
		path: "/",
		secure: new URL(c.req.url).protocol === "https:",
	});
	return new Response(null, { status: 200 });
});
