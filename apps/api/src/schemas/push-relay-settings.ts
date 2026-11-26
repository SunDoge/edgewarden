import * as v from "valibot";

export const UpdatePushRelaySettingsSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
  region: v.picklist(["US", "EU"]),
  installationId: v.optional(v.pipe(v.string(), v.maxLength(200))),
  installationKey: v.optional(v.pipe(v.string(), v.maxLength(500))),
  clearInstallationId: v.optional(v.boolean(), false),
  clearInstallationKey: v.optional(v.boolean(), false),
});

export const TestPushRelaySettingsSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});
