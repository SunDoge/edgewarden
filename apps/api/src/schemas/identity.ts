import * as v from "valibot";

export const PreloginSchema = v.object({
  email: v.pipe(v.string(), v.email()),
});

export const TokenFormSchema = v.object({
  grant_type: v.picklist([
    "password",
    "refresh_token",
    "client_credentials",
    "webauthn",
  ]),
  username: v.optional(v.string()),
  password: v.optional(v.string()),
  captchaResponse: v.optional(v.pipe(v.string(), v.maxLength(2048))),
  CaptchaResponse: v.optional(v.pipe(v.string(), v.maxLength(2048))),
  refresh_token: v.optional(v.string()),
  // 2FA fields
  twoFactorToken: v.optional(v.string()),
  TwoFactorToken: v.optional(v.string()),
  twoFactorProvider: v.optional(v.string()),
  TwoFactorProvider: v.optional(v.string()),
  twoFactorRemember: v.optional(v.string()),
  TwoFactorRemember: v.optional(v.string()),
  // Device fields
  deviceIdentifier: v.optional(v.string()),
  DeviceIdentifier: v.optional(v.string()),
  deviceName: v.optional(v.string()),
  DeviceName: v.optional(v.string()),
  deviceType: v.optional(v.string()),
  DeviceType: v.optional(v.string()),
  devicePushToken: v.optional(v.pipe(v.string(), v.maxLength(4096))),
  DevicePushToken: v.optional(v.pipe(v.string(), v.maxLength(4096))),
  // Auth request
  authRequest: v.optional(v.string()),
  AuthRequest: v.optional(v.string()),
  // Client creds
  client_id: v.optional(v.string()),
  client_secret: v.optional(v.string()),
  // Passkey grant
  token: v.optional(v.string()),
  deviceResponse: v.optional(v.unknown()),
});

export const RevocationSchema = v.object({
  token: v.optional(v.string(), ""),
});
