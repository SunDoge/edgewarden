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
import {
	getPushRelayStatus,
	logPushRelayFailure,
	pushDeviceRegistrationFromDatabase,
	unregisterPushDevice,
} from "../services/push-relay";
import type { Devices } from "../types/db";
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
	const identifier =
		c.req.header("X-Device-Identifier") ??
		c.req.query("deviceIdentifier") ??
		"";
	if (!identifier) return c.json(false);
	const device = await devicesDb.getDevice(
		c.get("db"),
		c.get("user").id,
		identifier,
	);
	return c.json(Boolean(device));
});

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
			.where(({ exists }) => exists(currentDevice))
			.compile(),
		db
			.deleteFrom("device_trust_tokens")
			.where("user_id", "=", userId)
			.where("device_identifier", "=", id)
			.where(({ exists }) => exists(currentDevice))
			.compile(),
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
			.where(sql<boolean>`mutation_token IS ${device.mutation_token}`)
			.compile(),
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
					.where(matchesRefreshDevice)
					.compile(),
				db
					.deleteFrom("device_trust_tokens")
					.where("user_id", "=", userId)
					.where(matchesTrustedDevice)
					.compile(),
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
						)`)
					.compile(),
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
