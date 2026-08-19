import * as v from "valibot";

const optionalSecretFields = {
  masterPasswordHash: v.optional(v.string()),
  master_password_hash: v.optional(v.string()),
  secret: v.optional(v.string()),
  password: v.optional(v.string()),
};

export const PasskeySecretSchema = v.pipe(
  v.looseObject(optionalSecretFields),
  v.check(
    (body) =>
      Boolean(
        body.masterPasswordHash ??
          body.master_password_hash ??
          body.secret ??
          body.password,
      ),
    "Master password verification is required",
  ),
);

export const PasskeyAssertionOptionsSchema = v.pipe(
  v.looseObject({
    ...optionalSecretFields,
    credentialId: v.optional(v.string()),
    id: v.optional(v.string()),
  }),
  v.check(
    (body) =>
      Boolean(
        body.masterPasswordHash ??
          body.master_password_hash ??
          body.secret ??
          body.password,
      ),
    "Master password verification is required",
  ),
);

const passkeyKeySet = {
  encryptedUserKey: v.optional(v.string()),
  encryptedPublicKey: v.optional(v.string()),
  encryptedPrivateKey: v.optional(v.string()),
};

export const PasskeyRegistrationSchema = v.looseObject({
  token: v.pipe(v.string(), v.minLength(1)),
  deviceResponse: v.unknown(),
  name: v.optional(v.string()),
  supportsPrf: v.optional(v.boolean()),
  ...passkeyKeySet,
});

export const PasskeyEncryptionSchema = v.pipe(
  v.looseObject({
    token: v.pipe(v.string(), v.minLength(1)),
    deviceResponse: v.unknown(),
    ...passkeyKeySet,
  }),
  v.check(
    (body) =>
      Boolean(
        body.encryptedUserKey &&
          body.encryptedPublicKey &&
          body.encryptedPrivateKey,
      ),
    "Encrypted passkey key set is required",
  ),
);

export const TwoFactorPasskeyRegistrationSchema = v.looseObject({
  ...optionalSecretFields,
  token: v.pipe(v.string(), v.minLength(1)),
  deviceResponse: v.unknown(),
  name: v.optional(v.string()),
});

export const TwoFactorPasskeyDeleteSchema = v.looseObject({
  ...optionalSecretFields,
  id: v.pipe(v.string(), v.minLength(1)),
});
