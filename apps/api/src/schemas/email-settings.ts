import * as v from "valibot";

export const UpdateEmailSettingsSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
  enabled: v.boolean(),
  provider: v.picklist(["auto", "cloudflare", "resend"]),
  from: v.pipe(
    v.string(),
    v.maxLength(320),
    v.check((value) => !/[\r\n]/.test(value), "Sender must be one line"),
  ),
  replyTo: v.nullable(
    v.pipe(
      v.string(),
      v.maxLength(254),
      v.check((value) => !/[\r\n]/.test(value), "Reply-To must be one line"),
    ),
  ),
  privacyMode: v.picklist(["minimal", "detailed"]),
  resendApiKey: v.optional(v.pipe(v.string(), v.maxLength(500))),
  clearResendApiKey: v.optional(v.boolean(), false),
});

export const TestEmailSettingsSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});
