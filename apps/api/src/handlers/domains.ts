import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import type { InferOutput } from "valibot";
import type { HonoEnv } from "../env";
import { factory } from "../http/factory";
import { DomainSettingsSchema } from "../schemas/requests";
import * as domainSettingsDb from "../services/db/domain-settings";
import {
	buildDomainsResponse,
	customRulesToActiveEquivalentDomains,
	normalizeCustomEquivalentDomains,
	normalizeEquivalentDomains,
	normalizeExcludedGlobalTypes,
} from "../services/domain-rules";

function firstPresent(
	payload: Record<string, unknown>,
	keys: string[],
): unknown {
	for (const key of keys) {
		if (Object.hasOwn(payload, key)) return payload[key];
	}
	return undefined;
}

// GET /api/settings/domains
export const getDomains = factory.createHandlers(async (c) => {
	const user = c.get("user");
	const db = c.get("db");

	const settings = await domainSettingsDb.getDomainSettings(db, user.id);

	const equivalentDomains = settings
		? (JSON.parse(settings.equivalent_domains) as string[][])
		: [];
	const customEquivalentDomains = settings
		? normalizeCustomEquivalentDomains(
				JSON.parse(settings.custom_equivalent_domains),
			)
		: [];
	const excludedGlobalEquivalentDomains = settings
		? (JSON.parse(settings.excluded_global_equivalent_domains) as number[])
		: [];

	return c.json(
		buildDomainsResponse(
			equivalentDomains,
			customEquivalentDomains,
			excludedGlobalEquivalentDomains,
		),
	);
});

// PUT/POST /api/settings/domains
const updateDomainsHandler = async (
	c: Context<HonoEnv>,
	payload: InferOutput<typeof DomainSettingsSchema>,
) => {
	const user = c.get("user");
	const db = c.get("db");

	const current = await domainSettingsDb.getDomainSettings(db, user.id);
	const currentCustomEquivalentDomains = current
		? normalizeCustomEquivalentDomains(
				JSON.parse(current.custom_equivalent_domains),
			)
		: [];
	const currentExcludedGlobalEquivalentDomains = current
		? (JSON.parse(current.excluded_global_equivalent_domains) as number[])
		: [];

	const equivalentDomainsRaw = firstPresent(payload, [
		"equivalentDomains",
		"EquivalentDomains",
	]);
	const customEquivalentDomainsRaw = firstPresent(payload, [
		"customEquivalentDomains",
		"CustomEquivalentDomain",
		"CustomEquivalentDomains",
	]);
	const excludedGlobalEquivalentDomainsRaw = firstPresent(payload, [
		"excludedGlobalEquivalentDomains",
		"ExcludedGlobalEquivalentDomains",
		"globalEquivalentDomains",
		"GlobalEquivalentDomains",
	]);

	const customEquivalentDomains =
		customEquivalentDomainsRaw === undefined
			? equivalentDomainsRaw === undefined
				? currentCustomEquivalentDomains
				: normalizeCustomEquivalentDomains(
						normalizeEquivalentDomains(equivalentDomainsRaw),
					)
			: normalizeCustomEquivalentDomains(customEquivalentDomainsRaw);

	const equivalentDomains = customRulesToActiveEquivalentDomains(
		customEquivalentDomains,
	);

	const excludedGlobalEquivalentDomains =
		excludedGlobalEquivalentDomainsRaw === undefined
			? currentExcludedGlobalEquivalentDomains
			: normalizeExcludedGlobalTypes(excludedGlobalEquivalentDomainsRaw);

	await domainSettingsDb.upsertDomainSettings(
		db,
		user.id,
		JSON.stringify(equivalentDomains),
		JSON.stringify(customEquivalentDomains),
		JSON.stringify(excludedGlobalEquivalentDomains),
	);

	return c.json(
		buildDomainsResponse(
			equivalentDomains,
			customEquivalentDomains,
			excludedGlobalEquivalentDomains,
		),
	);
};

export const updateDomains = factory.createHandlers(
	vValidator("json", DomainSettingsSchema),
	(c) => updateDomainsHandler(c, c.req.valid("json")),
);
