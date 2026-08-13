import * as v from "valibot";

const nonEmptyString = v.pipe(v.string(), v.trim(), v.minLength(1));
const deviceType = v.pipe(v.number(), v.integer(), v.minValue(0));

export const DeviceNameSchema = v.object({
	name: v.pipe(nonEmptyString, v.maxLength(128)),
});

export const DevicePushTokenSchema = v.pipe(
	v.looseObject({
		pushToken: v.optional(v.string()),
		PushToken: v.optional(v.string()),
	}),
	v.transform((body) => ({
		pushToken: String(body.pushToken ?? body.PushToken ?? "").trim(),
	})),
	v.check(
		(body) => body.pushToken.length > 0 && body.pushToken.length <= 4096,
		"Push token is required",
	),
);

export const DeviceKeysSchema = v.pipe(
	v.looseObject({
		encryptedUserKey: v.optional(v.string()),
		EncryptedUserKey: v.optional(v.string()),
		encryptedPublicKey: v.optional(v.string()),
		EncryptedPublicKey: v.optional(v.string()),
		encryptedPrivateKey: v.optional(v.string()),
		EncryptedPrivateKey: v.optional(v.string()),
	}),
	v.transform((body) => ({
		encryptedUserKey: body.encryptedUserKey ?? body.EncryptedUserKey ?? "",
		encryptedPublicKey:
			body.encryptedPublicKey ?? body.EncryptedPublicKey ?? "",
		encryptedPrivateKey:
			body.encryptedPrivateKey ?? body.EncryptedPrivateKey ?? "",
	})),
	v.check(
		(body) => Object.values(body).every((value) => value.length > 0),
		"All encrypted keys are required",
	),
);

export const AuthRequestCreateSchema = v.pipe(
	v.looseObject({
		email: v.pipe(v.string(), v.email()),
		type: v.optional(
			v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2)),
			0,
		),
		deviceIdentifier: v.optional(v.string()),
		DeviceIdentifier: v.optional(v.string()),
		deviceType: v.optional(deviceType),
		DeviceType: v.optional(deviceType),
		accessCode: v.optional(v.string()),
		AccessCode: v.optional(v.string()),
		publicKey: v.optional(v.string()),
		PublicKey: v.optional(v.string()),
	}),
	v.transform((body) => ({
		email: body.email.toLowerCase(),
		type: body.type,
		deviceIdentifier: body.deviceIdentifier ?? body.DeviceIdentifier ?? "",
		deviceType: body.deviceType ?? body.DeviceType ?? 0,
		accessCode: body.accessCode ?? body.AccessCode ?? "",
		publicKey: body.publicKey ?? body.PublicKey ?? "",
	})),
	v.check(
		(body) =>
			body.deviceIdentifier.length > 0 &&
			body.accessCode.length > 0 &&
			body.publicKey.length > 0,
		"Device identifier, access code and public key are required",
	),
);

export const AuthRequestUpdateSchema = v.pipe(
	v.looseObject({
		requestApproved: v.optional(v.boolean()),
		approved: v.optional(v.boolean()),
		key: v.optional(v.nullable(v.string())),
		Key: v.optional(v.nullable(v.string())),
		masterPasswordHash: v.optional(v.nullable(v.string())),
	}),
	v.transform((body) => ({
		approved: body.requestApproved ?? body.approved ?? false,
		key: body.key ?? body.Key ?? null,
		masterPasswordHash: body.masterPasswordHash ?? null,
	})),
);

const equivalentDomains = v.array(v.array(nonEmptyString));
const customEquivalentDomains = v.array(
	v.union([
		v.array(nonEmptyString),
		v.object({
			id: v.optional(v.string()),
			domains: v.array(nonEmptyString),
			excluded: v.optional(v.boolean()),
		}),
	]),
);
const excludedGlobalDomains = v.array(
	v.union([
		v.pipe(v.number(), v.integer(), v.minValue(0)),
		v.object({
			type: v.pipe(v.number(), v.integer(), v.minValue(0)),
			excluded: v.optional(v.boolean()),
		}),
	]),
);

export const DomainSettingsSchema = v.looseObject({
	equivalentDomains: v.optional(equivalentDomains),
	EquivalentDomains: v.optional(equivalentDomains),
	customEquivalentDomains: v.optional(customEquivalentDomains),
	CustomEquivalentDomain: v.optional(customEquivalentDomains),
	CustomEquivalentDomains: v.optional(customEquivalentDomains),
	excludedGlobalEquivalentDomains: v.optional(excludedGlobalDomains),
	ExcludedGlobalEquivalentDomains: v.optional(excludedGlobalDomains),
	globalEquivalentDomains: v.optional(excludedGlobalDomains),
	GlobalEquivalentDomains: v.optional(excludedGlobalDomains),
});
