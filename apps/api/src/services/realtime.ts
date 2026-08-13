import { createDatabase } from "../middleware/db";

export interface VaultChangeMessage {
	type: "vault-revision";
	revisionDate: number;
	userId: string;
}

export interface RealtimePublishResult {
	delivered: number;
	failed: number;
}

export async function publishVaultChange(
	env: CloudflareBindings,
	userIds: Iterable<string>,
	revisionDate = Math.floor(Date.now() / 1000),
): Promise<RealtimePublishResult> {
	const recipients = [...new Set(userIds)];
	const deliveries = await Promise.allSettled(
		recipients.map(async (userId) => {
			const message: VaultChangeMessage = {
				type: "vault-revision",
				revisionDate,
				userId,
			};
			const response = await env.REALTIME.getByName(userId).fetch(
				"https://realtime.internal/broadcast",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(message),
				},
			);
			if (!response.ok) {
				throw new Error(`Realtime broadcast returned ${response.status}`);
			}
		}),
	);
	let failed = 0;
	for (const [index, delivery] of deliveries.entries()) {
		if (delivery.status === "fulfilled") continue;
		failed += 1;
		console.error(
			JSON.stringify({
				event: "realtime.broadcast.failed",
				userId: recipients[index],
				error:
					delivery.reason instanceof Error
						? delivery.reason.message
						: String(delivery.reason),
			}),
		);
	}
	return { delivered: recipients.length - failed, failed };
}

export async function publishMutationVaultChange(
	env: CloudflareBindings,
	userId: string,
	organizationId: string | null,
): Promise<RealtimePublishResult> {
	const audience = new Set<string>([userId]);
	if (organizationId) {
		const { db } = await createDatabase(env.DB);
		try {
			const members = await db
				.selectFrom("org_members")
				.select("user_id")
				.where("org_id", "=", organizationId)
				.where("status", "=", "confirmed")
				.where("user_id", "is not", null)
				.execute();
			for (const member of members) {
				if (member.user_id) audience.add(member.user_id);
			}
		} finally {
			await db.destroy();
		}
	}
	return publishVaultChange(env, audience);
}
