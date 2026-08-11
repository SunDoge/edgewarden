import * as v from "valibot";

export const AdminPasswordSchema = v.object({
	masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});

export const CreateInviteSchema = v.object({
	masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
	expiresInHours: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(720)),
		168,
	),
});

export const SetUserStatusSchema = v.object({
	masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
	status: v.picklist(["active", "banned"]),
});

export const RegistrationPolicySchema = v.object({
	masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
	signupsAllowed: v.boolean(),
	invitationsAllowed: v.boolean(),
});

export const AuditLogQuerySchema = v.object({
	limit: v.optional(
		v.pipe(
			v.string(),
			v.transform(Number),
			v.integer(),
			v.minValue(1),
			v.maxValue(200),
		),
	),
	offset: v.optional(
		v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(0)),
	),
	category: v.optional(v.picklist(["auth", "vault", "admin", "system", "org"])),
	level: v.optional(v.picklist(["info", "warning", "error"])),
	q: v.optional(v.pipe(v.string(), v.maxLength(200))),
});

export const AuditLogSettingsSchema = v.pipe(
	v.object({
		retentionDays: v.nullable(v.optional(v.picklist([7, 30, 90, 180, 365]))),
		maxEntries: v.nullable(
			v.optional(
				v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(1_000_000)),
			),
		),
	}),
	v.check(
		(value) => !(value.retentionDays && value.maxEntries),
		"Choose retention days or maximum entries, not both",
	),
);

export const DeleteInvitesQuerySchema = v.object({
	scope: v.optional(v.literal("invalid")),
});

export type AdminPasswordInput = v.InferOutput<typeof AdminPasswordSchema>;
export type CreateInviteInput = v.InferOutput<typeof CreateInviteSchema>;
export type SetUserStatusInput = v.InferOutput<typeof SetUserStatusSchema>;
export type AuditLogQueryInput = v.InferOutput<typeof AuditLogQuerySchema>;
