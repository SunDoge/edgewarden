import * as v from "valibot";

const deviceTypeFormValue = v.pipe(
  v.string(),
  v.regex(/^(?:0|[1-9]\d{0,2})$/, "Device type must be an integer"),
  v.check(
    (value) => Number(value) <= 255,
    "Device type must fit the Bitwarden byte enum",
  ),
);

export const PreloginSchema = v.object({
  email: v.pipe(v.string(), v.email()),
});

export const TokenFormSchema = v.object({
  grant_type: v.picklist([
    "password",
    "refresh_token",
    "client_credentials",
    "send_access",
    "webauthn",
  ]),
  username: v.optional(v.pipe(v.string(), v.maxLength(254))),
  password: v.optional(v.pipe(v.string(), v.maxLength(4096))),
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
  deviceIdentifier: v.optional(v.pipe(v.string(), v.maxLength(50))),
  DeviceIdentifier: v.optional(v.pipe(v.string(), v.maxLength(50))),
  deviceName: v.optional(v.pipe(v.string(), v.maxLength(128))),
  DeviceName: v.optional(v.pipe(v.string(), v.maxLength(128))),
  deviceType: v.optional(deviceTypeFormValue),
  DeviceType: v.optional(deviceTypeFormValue),
  devicePushToken: v.optional(v.pipe(v.string(), v.maxLength(4096))),
  DevicePushToken: v.optional(v.pipe(v.string(), v.maxLength(4096))),
  // Auth request
  authRequest: v.optional(v.pipe(v.string(), v.maxLength(36))),
  AuthRequest: v.optional(v.pipe(v.string(), v.maxLength(36))),
  // Client creds
  client_id: v.optional(v.string()),
  client_secret: v.optional(v.string()),
  // Anonymous Send access grant
  send_id: v.optional(v.string()),
  password_hash_b64: v.optional(v.string()),
  email: v.optional(v.string()),
  otp: v.optional(v.string()),
  // Passkey grant
  token: v.optional(v.string()),
  deviceResponse: v.optional(v.unknown()),
});

export const RevocationSchema = v.object({
  token: v.optional(v.string(), ""),
});
