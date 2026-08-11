import type { Context } from "hono";
import type { HonoEnv } from "../env";

export interface VaultChangeMessage {
	type: "vault-revision";
	revisionDate: number;
}

function hasRealtime(env: CloudflareBindings): boolean {
	return !!(env as any).REALTIME;
}

export async function publishVaultChange(
	env: CloudflareBindings,
	userIds: Iterable<string>,
	revisionDate = Math.floor(Date.now() / 1000),
): Promise<void> {
	if (!hasRealtime(env)) return;
	const message: VaultChangeMessage = { type: "vault-revision", revisionDate };
	await Promise.allSettled(
		[...new Set(userIds)].map((userId) =>
			(env as any).REALTIME.getByName(userId).fetch("https://realtime.internal/broadcast", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(message),
			}),
		),
	);
}

export async function realtimeAudience(c: Context<HonoEnv>): Promise<string[]> {
	const ids = new Set<string>([c.get("user").id]);
	const cipher = c.get("cipher");
	const orgId = cipher?.org_id || c.req.param("orgId");
	if (orgId) {
		const members = await c.get("db")
			.selectFrom("org_members")
			.select("user_id")
			.where("org_id", "=", orgId)
			.where("status", "=", "confirmed")
			.where("user_id", "is not", null)
			.execute();
		for (const member of members) if (member.user_id) ids.add(member.user_id);
	}
	return [...ids];
}
