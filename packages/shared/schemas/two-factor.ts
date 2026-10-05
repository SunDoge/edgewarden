import * as v from "valibot";

export const TotpSetupSchema = v.object({
  token: v.pipe(v.string(), v.regex(/^\d{6}$/, "Must be 6 digits")),
  key: v.pipe(v.string(), v.minLength(1)), // base32 TOTP secret
  userVerificationToken: v.pipe(v.string(), v.minLength(1)),
});

export const SecretVerificationSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});

export const AuthenticatorDeleteSchema = v.object({
  key: v.pipe(v.string(), v.minLength(1)),
  userVerificationToken: v.pipe(v.string(), v.minLength(1)),
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

const YubikeyOtpSchema = v.optional(
  v.nullable(v.pipe(v.string(), v.minLength(12), v.maxLength(64))),
);

export const SaveYubicoKeysSchema = v.pipe(
  v.object({
    key1: YubikeyOtpSchema,
    key2: YubikeyOtpSchema,
    key3: YubikeyOtpSchema,
    key4: YubikeyOtpSchema,
    key5: YubikeyOtpSchema,
    nfc: v.boolean(),
    userVerificationToken: v.pipe(v.string(), v.minLength(1)),
  }),
  v.check(
    (body) =>
      Boolean(body.key1 || body.key2 || body.key3 || body.key4 || body.key5),
    "At least one YubiKey OTP is required",
  ),
);

export const DeleteYubicoKeysSchema = v.object({
  userVerificationToken: v.pipe(v.string(), v.minLength(1)),
});

export const SaveYubicoConfigSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
  clientId: v.pipe(v.string(), v.regex(/^\d+$/), v.maxLength(32)),
  secretKey: v.pipe(v.string(), v.minLength(16), v.maxLength(256)),
});

export type TotpSetupInput = v.InferOutput<typeof TotpSetupSchema>;
export type SecretVerificationInput = v.InferOutput<
  typeof SecretVerificationSchema
>;
export type AuthenticatorDeleteInput = v.InferOutput<
  typeof AuthenticatorDeleteSchema
>;
export type DisableTotpInput = v.InferOutput<typeof DisableTotpSchema>;
export type RecoverTwoFactorInput = v.InferOutput<
  typeof RecoverTwoFactorSchema
>;
export type YubicoSettingsInput = v.InferOutput<typeof YubicoSettingsSchema>;
export type SaveYubicoKeysInput = v.InferOutput<typeof SaveYubicoKeysSchema>;
export type DeleteYubicoKeysInput = v.InferOutput<
  typeof DeleteYubicoKeysSchema
>;
export type SaveYubicoConfigInput = v.InferOutput<
  typeof SaveYubicoConfigSchema
>;
