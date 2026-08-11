import * as v from "valibot";

export const RegisterSchema = v.object({
	email: v.pipe(v.string(), v.email()),
	name: v.optional(v.string()),
	inviteCode: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(128))),
	captchaResponse: v.optional(
		v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
	),
	adminPassword: v.optional(
		v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
	),
	masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
	masterPasswordHint: v.optional(v.nullable(v.string())),
	key: v.pipe(v.string(), v.minLength(1)),
	kdf: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1)),
	kdfIterations: v.pipe(v.number(), v.integer(), v.minValue(1)),
	kdfMemory: v.optional(v.nullable(v.number())),
	kdfParallelism: v.optional(v.nullable(v.number())),
	keys: v.optional(
		v.object({
			publicKey: v.string(),
			encryptedPrivateKey: v.string(),
		}),
	),
});

export const ChangePasswordSchema = v.object({
	masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
	newMasterPasswordHash: v.pipe(v.string(), v.minLength(1)),
	key: v.pipe(v.string(), v.minLength(1)),
	masterPasswordHint: v.optional(v.nullable(v.string())),
});

export const UpdateProfileSchema = v.object({
	name: v.optional(v.nullable(v.string())),
	masterPasswordHint: v.optional(v.nullable(v.string())),
});

export const SetKeysSchema = v.object({
	publicKey: v.pipe(v.string(), v.minLength(1)),
	encryptedPrivateKey: v.pipe(v.string(), v.minLength(1)),
});

export const VerifyPasswordSchema = v.object({
	masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});

export type RegisterInput = v.InferOutput<typeof RegisterSchema>;
export type ChangePasswordInput = v.InferOutput<typeof ChangePasswordSchema>;
export type UpdateProfileInput = v.InferOutput<typeof UpdateProfileSchema>;
export type SetKeysInput = v.InferOutput<typeof SetKeysSchema>;
export type VerifyPasswordInput = v.InferOutput<typeof VerifyPasswordSchema>;
