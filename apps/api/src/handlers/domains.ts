import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import type { InferOutput } from "valibot";
import type { HonoEnv } from "../env";
import { factory } from "../http/factory";
import { DomainSettingsSchema } from "../schemas/requests";
import { executeBatch, revisionQuery } from "../services/db/batch";
import * as domainSettingsDb from "../services/db/domain-settings";
import {
  buildDomainsResponse,
  customRulesToActiveEquivalentDomains,
  normalizeCustomEquivalentDomains,
  normalizeEquivalentDomains,
  normalizeExcludedGlobalTypes,
  parseStoredDomainSettings,
} from "../services/domain-rules";
import { now } from "../utils/time";

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

  const {
    equivalentDomains,
    customEquivalentDomains,
    excludedGlobalEquivalentDomains,
  } = settings
    ? parseStoredDomainSettings(settings)
    : {
        equivalentDomains: [],
        customEquivalentDomains: [],
        excludedGlobalEquivalentDomains: [],
      };

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
  const currentSettings = current ? parseStoredDomainSettings(current) : null;
  const currentCustomEquivalentDomains =
    currentSettings?.customEquivalentDomains ?? [];
  const currentExcludedGlobalEquivalentDomains =
    currentSettings?.excludedGlobalEquivalentDomains ?? [];

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

  const timestamp = now();
  await executeBatch(c.get("dbDialect"), [
    domainSettingsDb.upsertDomainSettingsQuery(
      db,
      user.id,
      JSON.stringify(equivalentDomains),
      JSON.stringify(customEquivalentDomains),
      JSON.stringify(excludedGlobalEquivalentDomains),
      timestamp,
    ),
    revisionQuery(db, user.id, timestamp),
  ]);

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
