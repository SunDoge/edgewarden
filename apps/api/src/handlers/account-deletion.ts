import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import { VerifyPasswordSchema } from "../schemas/accounts";
import { verifyPassword, invalidateUserCache } from "../services/auth";
import { deleteAccountData } from "../services/account-deletion";
import { auditRequestMetadata } from "../services/audit";
import { errorResponse } from "../utils/response";

export const deleteAccount = factory.createHandlers(
	vValidator("json", VerifyPasswordSchema),
	async (c) => {
		const user = c.get("user");
		if (
			!(await verifyPassword(
				c.req.valid("json").masterPasswordHash,
				user.master_password_hash,
				user.email,
			))
		)
			return errorResponse("Invalid password", 400);
		const result = await deleteAccountData(
			c.get("db"),
			c.get("dbDialect"),
			user.id,
			{
				action: "account.delete",
				category: "auth",
				level: "warning",
				targetType: "user",
				targetId: user.id,
				metadata: auditRequestMetadata(c.req.raw),
			},
		);
		if (!result)
			return errorResponse(
				"Delete or transfer organizations owned by this account first",
				409,
			);
		invalidateUserCache(user.id);
		return new Response(null, { status: 204 });
	},
);
