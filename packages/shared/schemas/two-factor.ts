import * as v from "valibot";

export const TotpSetupSchema = v.object({
  token: v.pipe(v.string(), v.regex(/^\d{6}$/, "Must be 6 digits")),
  key: v.pipe(v.string(), v.minLength(1)), // base32 TOTP secret
});

export const TotpVerifySchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});

export const DisableTotpSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});

export const RecoverTwoFactorSchema = v.object({
  email: v.pipe(v.string(), v.email()),
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
  recoveryCode: v.pipe(v.string(), v.minLength(8), v.maxLength(64)),
});

export const YubicoSettingsSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});

export const SaveYubicoKeysSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
  otps: v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(64))),
    v.minLength(1),
    v.maxLength(5),
  ),
  nfc: v.optional(v.boolean(), false),
});

export const SaveYubicoConfigSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
  clientId: v.pipe(v.string(), v.regex(/^\d+$/), v.maxLength(32)),
  secretKey: v.pipe(v.string(), v.minLength(16), v.maxLength(256)),
});

export type TotpSetupInput = v.InferOutput<typeof TotpSetupSchema>;
export type TotpVerifyInput = v.InferOutput<typeof TotpVerifySchema>;
export type DisableTotpInput = v.InferOutput<typeof DisableTotpSchema>;
export type RecoverTwoFactorInput = v.InferOutput<
  typeof RecoverTwoFactorSchema
>;
export type YubicoSettingsInput = v.InferOutput<typeof YubicoSettingsSchema>;
export type SaveYubicoKeysInput = v.InferOutput<typeof SaveYubicoKeysSchema>;
export type SaveYubicoConfigInput = v.InferOutput<
  typeof SaveYubicoConfigSchema
>;
