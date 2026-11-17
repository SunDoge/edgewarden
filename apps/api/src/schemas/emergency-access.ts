import * as v from "valibot";

const AccessTypeSchema = v.union([
  v.literal(0),
  v.literal(1),
  v.literal("0"),
  v.literal("1"),
  v.literal("View"),
  v.literal("Takeover"),
]);

export const EmergencyAccessInviteSchema = v.object({
  email: v.pipe(
    v.string(),
    v.trim(),
    v.toLowerCase(),
    v.email(),
    v.maxLength(254),
  ),
  type: AccessTypeSchema,
  waitTimeDays: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(90)),
});

export const EmergencyAccessUpdateSchema = v.object({
  type: AccessTypeSchema,
  waitTimeDays: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(90)),
  keyEncrypted: v.optional(
    v.pipe(v.string(), v.minLength(3), v.maxLength(8192)),
  ),
});

export const EmergencyAccessConfirmSchema = v.object({
  key: v.pipe(v.string(), v.minLength(3), v.maxLength(8192)),
});

const KdfSchema = v.object({
  kdfType: v.picklist([0, 1]),
  iterations: v.pipe(v.number(), v.integer(), v.minValue(1)),
  memory: v.nullish(v.pipe(v.number(), v.integer(), v.minValue(8))),
  parallelism: v.nullish(v.pipe(v.number(), v.integer(), v.minValue(1))),
});

export const EmergencyAccessPasswordSchema = v.pipe(
  v.object({
    newMasterPasswordHash: v.optional(
      v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
    ),
    key: v.optional(v.pipe(v.string(), v.minLength(3), v.maxLength(8192))),
    authenticationData: v.optional(
      v.object({
        salt: v.pipe(v.string(), v.minLength(1), v.maxLength(254)),
        kdf: KdfSchema,
        masterPasswordAuthenticationHash: v.pipe(
          v.string(),
          v.minLength(1),
          v.maxLength(1024),
        ),
      }),
    ),
    unlockData: v.optional(
      v.object({
        salt: v.pipe(v.string(), v.minLength(1), v.maxLength(254)),
        kdf: KdfSchema,
        masterKeyWrappedUserKey: v.pipe(
          v.string(),
          v.minLength(3),
          v.maxLength(8192),
        ),
        containedKeyId: v.nullish(v.string()),
      }),
    ),
  }),
  v.check(
    (body) =>
      Boolean(body.newMasterPasswordHash && body.key) !==
      Boolean(body.authenticationData && body.unlockData),
    "Provide either legacy password fields or authenticationData and unlockData",
  ),
);

export function emergencyAccessType(
  value: v.InferOutput<typeof AccessTypeSchema>,
): 0 | 1 {
  return value === 0 || value === "0" || value === "View" ? 0 : 1;
}
