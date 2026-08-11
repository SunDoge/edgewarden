import type { Kysely, Selectable } from "kysely";
import type { DB, DomainSettings } from "../../types/db";
import { now } from "../../utils/time";

export async function getDomainSettings(
	db: Kysely<DB>,
	userId: string,
): Promise<Selectable<DomainSettings> | null> {
	return (
		(await db
			.selectFrom("domain_settings")
			.selectAll()
			.where("user_id", "=", userId)
			.executeTakeFirst()) ?? null
	);
}

export async function upsertDomainSettings(
	db: Kysely<DB>,
	userId: string,
	equivalentDomains: string,
	customEquivalentDomains: string,
	excludedGlobalEquivalentDomains: string,
): Promise<void> {
	await db
		.insertInto("domain_settings")
		.values({
			user_id: userId,
			equivalent_domains: equivalentDomains,
			custom_equivalent_domains: customEquivalentDomains,
			excluded_global_equivalent_domains: excludedGlobalEquivalentDomains,
			updated_at: now(),
		})
		.onConflict((oc) =>
			oc.column("user_id").doUpdateSet({
				equivalent_domains: equivalentDomains,
				custom_equivalent_domains: customEquivalentDomains,
				excluded_global_equivalent_domains: excludedGlobalEquivalentDomains,
				updated_at: now(),
			}),
		)
		.execute();
}
