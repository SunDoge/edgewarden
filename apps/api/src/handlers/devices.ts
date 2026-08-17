import { vValidator } from "@hono/valibot-validator";
import type { Context } from "hono";
import { type Selectable, sql } from "kysely";
import type { HonoEnv } from "../env";
import { factory } from "../http/factory";
import { VerifyPasswordSchema } from "../schemas/accounts";
import { BulkIdsSchema } from "../schemas/ciphers";
import {
	DeviceKeysSchema,
	DeviceNameSchema,
	DevicePushTokenSchema,
	UntrustDevicesSchema,
	UpdateDevicesTrustSchema,
} from "../schemas/requests";
import { auditEventInsertQuery, auditRequestMetadata } from "../services/audit";
import { invalidateUserCache, verifyPassword } from "../services/auth";
import {
	conditionalAllDevicesDeletionClaimQuery,
	conditionalAllDevicesDeletionQuery,
	conditionalDeviceTrustTokenDeletionQuery,
	conditionalRefreshTokenDeletionQuery,
} from "../services/db/batch";
import * as devicesDb from "../services/db/devices";
import { textColumnInJson } from "../services/db/json-array";
import * as usersDb from "../services/db/users";
import {
	getPushRelayStatus,
	logPushRelayFailure,
	pushDeviceRegistrationFromDatabase,
	unregisterPushDevice,
} from "../services/push-relay";
import type { Devices } from "../types/db";
import { decodeBase64Url } from "../utils/base64-url";
import { errorResponse } from "../utils/response";
import { now, toIso } from "../utils/time";

function deviceToResponse(device: Selectable<Devices>) {
	return {
		id: device.device_identifier,
		name: device.name,
		type: device.type,
		identifier: device.device_identifier,
		creationDate: toIso(device.created_at),
		revisionDate: toIso(device.updated_at),
		lastLoginDate: device.last_seen_at ? toIso(device.last_seen_at) : null,
		encryptedUserKey: device.encrypted_user_key ?? null,
		encryptedPublicKey: device.encrypted_public_key ?? null,
		encryptedPrivateKey: device.encrypted_private_key ?? null,
		isTrusted: Boolean(
			device.encrypted_user_key &&
				device.encrypted_public_key &&
				device.encrypted_private_key,
		),
		object: "device",
	};
}

function schedulePushUnregistration(
	c: Context<HonoEnv>,
	pushUuids: Array<string | null>,
): void {
	if (!getPushRelayStatus(c.env).enabled) return;
	const ids = pushUuids.filter((id): id is string => Boolean(id));
	if (!ids.length) return;
	c.executionCtx.waitUntil(
		Promise.all(
			ids.map((id) =>
				unregisterPushDevice(c.env, id).catch((error) =>
					logPushRelayFailure("push.device.unregister.failed", error),
				),
			),
		),
	);
}

export const listDevices = factory.createHandlers(async (c) => {
	const devices = await devicesDb.getDevicesByUserId(
		c.get("db"),
		c.get("user").id,
	);
	return c.json({
		data: devices.map(deviceToResponse),
		object: "list",
		continuationToken: null,
	});
});

export const getKnownDevice = factory.createHandlers(async (c) => {
	const encodedEmail = c.req.header("X-Request-Email") ?? "";
	const identifier = c.req.header("X-Device-Identifier") ?? "";
	const bytes = decodeBase64Url(encodedEmail);
	if (!bytes || !identifier) return c.json(false);
	let email: string;
	try {
		email = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
			.decode(bytes)
			.trim()
			.toLowerCase();
	} catch {
		return c.json(false);
	}
	const user = await usersDb.getUserByEmail(c.get("db"), email);
	const device = user
		? await devicesDb.getDevice(c.get("db"), user.id, identifier)
		: null;
	return c.json(Boolean(device));
});

export const updateDevicesTrust = factory.createHandlers(
	vValidator("json", UpdateDevicesTrustSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const body = c.req.valid("json");
		if (
			!(await verifyPassword(
				body.masterPasswordHash,
				user.master_password_hash,
				user.email,
			))
		)
			return errorResponse("User verification failed", 400);
		const currentIdentifier = c.get("payload").did ?? "";
		const devices = await devicesDb.getDevicesByUserId(db, user.id);
		const current = devices.find(
			(device) => device.device_identifier === currentIdentifier,
		);
		if (!current) return errorResponse("Device not found", 404);
		const updates = new Map(
			body.otherDevices.map((device) => [device.deviceId, device]),
		);
		if (updates.has(currentIdentifier))
			return errorResponse(
				"Current device cannot be an optional rotation",
				400,
			);
		if (
			[...updates.keys()].some(
				(id) => !devices.some((device) => device.device_identifier === id),
			)
		)
			return errorResponse("Device not found", 404);

		const timestamp = now();
		const rotationToken = crypto.randomUUID();
		const expectedDevices = JSON.stringify(
			devices.map((device) => ({
				id: device.device_identifier,
				mutationToken: device.mutation_token,
			})),
		);
		const [claimed] = await c.get("dbDialect").batch([
			db
				.updateTable("devices")
				.set({
					encrypted_user_key: body.currentDevice.encryptedUserKey,
					encrypted_public_key: body.currentDevice.encryptedPublicKey,
					updated_at: sql<number>`MAX(updated_at + 1, ${timestamp})`,
					mutation_token: rotationToken,
				})
				.where("user_id", "=", user.id)
				.where("device_identifier", "=", currentIdentifier)
				.where(sql<boolean>`NOT EXISTS (
					SELECT 1 FROM json_each(${expectedDevices}) expected
					LEFT JOIN devices device
					  ON device.user_id = ${user.id}
					 AND device.device_identifier = json_extract(expected.value, '$.id')
					WHERE device.device_identifier IS NULL
					   OR device.mutation_token IS NOT json_extract(expected.value, '$.mutationToken')
				)`),
			...devices
				.filter(
					(device) =>
						device.device_identifier !== currentIdentifier &&
						device.encrypted_user_key &&
						device.encrypted_public_key &&
						device.encrypted_private_key,
				)
				.map((device) => {
					const update = updates.get(device.device_identifier);
					return db
						.updateTable("devices")
						.set({
							encrypted_user_key: update?.encryptedUserKey ?? null,
							encrypted_public_key: update?.encryptedPublicKey ?? null,
							encrypted_private_key: update
								? device.encrypted_private_key
								: null,
							updated_at: sql<number>`MAX(updated_at + 1, ${timestamp})`,
							mutation_token: rotationToken,
						})
						.where("user_id", "=", user.id)
						.where("device_identifier", "=", device.device_identifier)
						.where(sql<boolean>`mutation_token IS ${device.mutation_token}`)
						.where((eb) =>
							eb.exists(
								db
									.selectFrom("devices as current_device")
									.select("current_device.device_identifier")
									.where("current_device.user_id", "=", user.id)
									.where(
										"current_device.device_identifier",
										"=",
										currentIdentifier,
									)
									.where("current_device.mutation_token", "=", rotationToken),
							),
						);
				}),
		]);
		if (claimed.numAffectedRows !== 1n)
			return errorResponse("Device trust changed by another request", 409);
		return new Response(null, { status: 204 });
	},
);

export const untrustDevices = factory.createHandlers(
	vValidator("json", UntrustDevicesSchema),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("user").id;
		const ids = c.req.valid("json").devices;
		const owned = ids.length
			? await db
					.selectFrom("devices")
					.select("device_identifier")
					.where("user_id", "=", userId)
					.where(textColumnInJson("device_identifier", ids))
					.execute()
			: [];
		if (owned.length !== ids.length) return errorResponse("Forbidden", 403);
		if (ids.length) {
			await db
				.updateTable("devices")
				.set({
					encrypted_user_key: null,
					encrypted_public_key: null,
					encrypted_private_key: null,
					updated_at: now(),
				})
				.where("user_id", "=", userId)
				.where(textColumnInJson("device_identifier", ids))
				.execute();
		}
		return new Response(null, { status: 204 });
	},
);

export const getDevice = factory.createHandlers(async (c) =>
	c.json(deviceToResponse(c.get("device"))),
);

export const updateDevicePushToken = factory.createHandlers(
	vValidator("json", DevicePushTokenSchema),
	async (c) => {
		if (!getPushRelayStatus(c.env).enabled)
			return new Response(null, { status: 200 });
		const device = c.get("device");
		await c
			.get("db")
			.updateTable("devices")
			.set({
				push_token: c.req.valid("json").pushToken,
				push_uuid: device.push_uuid ?? crypto.randomUUID(),
				updated_at: now(),
			})
			.where("user_id", "=", c.get("user").id)
			.where("device_identifier", "=", device.device_identifier)
			.execute();
		c.executionCtx.waitUntil(
			pushDeviceRegistrationFromDatabase(
				c.env,
				c.get("user").id,
				device.device_identifier,
			).catch((error) =>
				logPushRelayFailure("push.device.register.failed", error),
			),
		);
		return new Response(null, { status: 200 });
	},
);

export const clearDevicePushToken = factory.createHandlers(async (c) => {
	const device = c.get("device");
	await c
		.get("db")
		.updateTable("devices")
		.set({ push_token: null, push_uuid: null, updated_at: now() })
		.where("user_id", "=", c.get("user").id)
		.where("device_identifier", "=", device.device_identifier)
		.execute();
	schedulePushUnregistration(c, [device.push_uuid]);
	return new Response(null, { status: 200 });
});

export const deleteDevice = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const userId = c.get("user").id;
	const device = c.get("device");
	const id = device.device_identifier;
	const currentDevice = db
		.selectFrom("devices")
		.select("device_identifier")
		.where("user_id", "=", userId)
		.where("device_identifier", "=", id)
		.where(sql<boolean>`session_stamp IS ${device.session_stamp}`)
		.where(sql<boolean>`mutation_token IS ${device.mutation_token}`);
	const [, , , deleted] = await c.get("dbDialect").batch([
		db
			.deleteFrom("refresh_tokens")
			.where("user_id", "=", userId)
			.where("device_identifier", "=", id)
			.where(({ exists }) => exists(currentDevice)),
		db
			.deleteFrom("device_trust_tokens")
			.where("user_id", "=", userId)
			.where("device_identifier", "=", id)
			.where(({ exists }) => exists(currentDevice)),
		auditEventInsertQuery(
			db,
			{
				actorUserId: userId,
				action: "device.delete",
				category: "auth",
				level: "warning",
				targetType: "device",
				targetId: id,
				metadata: auditRequestMetadata(c.req.raw),
			},
			sql<boolean>`EXISTS (
				SELECT 1 FROM devices
				WHERE user_id = ${userId}
				  AND device_identifier = ${id}
				  AND session_stamp IS ${device.session_stamp}
				  AND mutation_token IS ${device.mutation_token}
			)`,
		),
		db
			.deleteFrom("devices")
			.where("user_id", "=", userId)
			.where("device_identifier", "=", id)
			.where(sql<boolean>`session_stamp IS ${device.session_stamp}`)
			.where(sql<boolean>`mutation_token IS ${device.mutation_token}`),
	]);
	if (deleted.numAffectedRows !== 1n)
		return errorResponse("Device not found", 404);
	invalidateUserCache(userId);
	schedulePushUnregistration(c, [device.push_uuid]);
	return new Response(null, { status: 200 });
});

export const deleteDevices = factory.createHandlers(
	vValidator("json", BulkIdsSchema),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("user").id;
		const ids = [...new Set(c.req.valid("json").ids)];
		const ownedDevices = await db
			.selectFrom("devices")
			.select([
				"device_identifier",
				"session_stamp",
				"mutation_token",
				"push_uuid",
			])
			.where("user_id", "=", userId)
			.where(textColumnInJson("device_identifier", ids))
			.execute();
		if (ownedDevices.length) {
			const expectedState = JSON.stringify(ownedDevices);
			const matchesRefreshDevice = sql<boolean>`exists (
				select 1 from devices current_device
				join json_each(${expectedState}) expected
				  on json_extract(expected.value, '$.device_identifier') = current_device.device_identifier
				 and current_device.session_stamp is json_extract(expected.value, '$.session_stamp')
				 and current_device.mutation_token is json_extract(expected.value, '$.mutation_token')
				where current_device.user_id = ${userId}
				  and current_device.device_identifier = refresh_tokens.device_identifier
			)`;
			const matchesTrustedDevice = sql<boolean>`exists (
				select 1 from devices current_device
				join json_each(${expectedState}) expected
				  on json_extract(expected.value, '$.device_identifier') = current_device.device_identifier
				 and current_device.session_stamp is json_extract(expected.value, '$.session_stamp')
				 and current_device.mutation_token is json_extract(expected.value, '$.mutation_token')
				where current_device.user_id = ${userId}
				  and current_device.device_identifier = device_trust_tokens.device_identifier
			)`;
			const [, , , deleted] = await c.get("dbDialect").batch([
				db
					.deleteFrom("refresh_tokens")
					.where("user_id", "=", userId)
					.where(matchesRefreshDevice),
				db
					.deleteFrom("device_trust_tokens")
					.where("user_id", "=", userId)
					.where(matchesTrustedDevice),
				auditEventInsertQuery(
					db,
					{
						actorUserId: userId,
						action: "device.delete.bulk",
						category: "auth",
						level: "warning",
						targetType: "device",
						metadata: auditRequestMetadata(c.req.raw),
					},
					sql<boolean>`EXISTS (
						SELECT 1 FROM devices current_device
						JOIN json_each(${expectedState}) expected
						  ON json_extract(expected.value, '$.device_identifier') = current_device.device_identifier
						 AND current_device.session_stamp IS json_extract(expected.value, '$.session_stamp')
						 AND current_device.mutation_token IS json_extract(expected.value, '$.mutation_token')
						WHERE current_device.user_id = ${userId}
					)`,
				),
				db
					.deleteFrom("devices")
					.where("user_id", "=", userId)
					.where(sql<boolean>`exists (
							select 1 from json_each(${expectedState}) expected
							where json_extract(expected.value, '$.device_identifier') = devices.device_identifier
							  and devices.session_stamp is json_extract(expected.value, '$.session_stamp')
							  and devices.mutation_token is json_extract(expected.value, '$.mutation_token')
						)`),
			]);
			const deletedCount = Number(deleted.numAffectedRows ?? 0n);
			if (deletedCount) {
				invalidateUserCache(userId);
				if (deletedCount === ownedDevices.length)
					schedulePushUnregistration(
						c,
						ownedDevices.map(({ push_uuid }) => push_uuid),
					);
			}
			return c.json({ deleted: deletedCount });
		}
		return c.json({ deleted: 0 });
	},
);

export const updateDeviceName = factory.createHandlers(
	vValidator("json", DeviceNameSchema),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("user").id;
		const device = c.get("device");
		if (
			!(await devicesDb.updateDeviceName(
				db,
				userId,
				device.device_identifier,
				c.req.valid("json").name,
				device.session_stamp,
				device.mutation_token,
			))
		)
			return errorResponse("Device changed during update", 409);
		const updated = await devicesDb.getDevice(
			db,
			userId,
			device.device_identifier,
		);
		if (!updated) return errorResponse("Device not found", 404);
		return c.json(deviceToResponse(updated));
	},
);

export const updateDeviceKeys = factory.createHandlers(
	vValidator("json", DeviceKeysSchema),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("user").id;
		const device = c.get("device");
		const { encryptedUserKey, encryptedPublicKey, encryptedPrivateKey } =
			c.req.valid("json");
		if (
			!(await devicesDb.updateDeviceKeys(
				db,
				userId,
				device.device_identifier,
				encryptedUserKey,
				encryptedPublicKey,
				encryptedPrivateKey,
				device.session_stamp,
				device.mutation_token,
			))
		)
			return errorResponse("Device changed during key update", 409);
		const updated = await devicesDb.getDevice(
			db,
			userId,
			device.device_identifier,
		);
		if (!updated) return errorResponse("Device not found", 404);
		return c.json(deviceToResponse(updated));
	},
);

export const deleteAllDevices = factory.createHandlers(
	vValidator("json", VerifyPasswordSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		if (
			!(await verifyPassword(
				c.req.valid("json").masterPasswordHash,
				user.master_password_hash,
				user.email,
			))
		)
			return c.json({ error: "Invalid password" }, 400);
		const userId = user.id;
		const pushDevices = await db
			.selectFrom("devices")
			.select("push_uuid")
			.where("user_id", "=", userId)
			.where("push_uuid", "is not", null)
			.execute();
		const securityStamp = crypto.randomUUID();
		const [claimed] = await c
			.get("dbDialect")
			.batch([
				conditionalAllDevicesDeletionClaimQuery(
					db,
					userId,
					user.security_stamp,
					securityStamp,
				),
				conditionalRefreshTokenDeletionQuery(db, userId, securityStamp),
				conditionalDeviceTrustTokenDeletionQuery(db, userId, securityStamp),
				conditionalAllDevicesDeletionQuery(db, userId, securityStamp),
			]);
		if (claimed.numAffectedRows !== 1n)
			return errorResponse("Account security changed by another request", 409);
		invalidateUserCache(userId);
		schedulePushUnregistration(
			c,
			pushDevices.map(({ push_uuid }) => push_uuid),
		);
		return new Response(null, { status: 200 });
	},
);
