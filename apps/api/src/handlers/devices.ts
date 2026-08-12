import { vValidator } from "@hono/valibot-validator";
import type { Selectable } from "kysely";
import { factory } from "../http/factory";
import { DeviceKeysSchema, DeviceNameSchema } from "../schemas/requests";
import { VerifyPasswordSchema } from "../schemas/accounts";
import { BulkIdsSchema } from "../schemas/ciphers";
import { invalidateUserCache, verifyPassword } from "../services/auth";
import { executeBatch } from "../services/db/batch";
import * as devicesDb from "../services/db/devices";
import { textColumnInJson } from "../services/db/json-array";
import type { Devices } from "../types/db";
import { toIso } from "../utils/time";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import { errorResponse } from "../utils/response";

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

export const deleteDevice = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const userId = c.get("user").id;
	const id = c.get("device").device_identifier;
	const [, deleted] = await c
		.get("dbDialect")
		.batch([
			db
				.deleteFrom("refresh_tokens")
				.where("user_id", "=", userId)
				.where("device_identifier", "=", id)
				.compile(),
			db
				.deleteFrom("devices")
				.where("user_id", "=", userId)
				.where("device_identifier", "=", id)
				.compile(),
		]);
	if (deleted.numAffectedRows !== 1n)
		return errorResponse("Device not found", 404);
	invalidateUserCache(userId);
	return new Response(null, { status: 200 });
});

export const deleteDevices = factory.createHandlers(
	vValidator("json", BulkIdsSchema),
	async (c) => {
		const db = c.get("db");
		const userId = c.get("user").id;
		const ids = [...new Set(c.req.valid("json").ids)];
		const ownedIds = (
			await db
				.selectFrom("devices")
				.select("device_identifier")
				.where("user_id", "=", userId)
				.where(textColumnInJson("device_identifier", ids))
				.execute()
		).map((device) => device.device_identifier);
		if (ownedIds.length) {
			const [, deleted] = await c
				.get("dbDialect")
				.batch([
					db
						.deleteFrom("refresh_tokens")
						.where("user_id", "=", userId)
						.where(textColumnInJson("device_identifier", ownedIds))
						.compile(),
					db
						.deleteFrom("devices")
						.where("user_id", "=", userId)
						.where(textColumnInJson("device_identifier", ownedIds))
						.compile(),
				]);
			const deletedCount = Number(deleted.numAffectedRows ?? 0n);
			if (deletedCount) {
				invalidateUserCache(userId);
				await safeWriteAuditEvent(db, {
					actorUserId: userId,
					action: "device.delete.bulk",
					category: "auth",
					level: "warning",
					targetType: "device",
					metadata: {
						...auditRequestMetadata(c.req.raw),
						size: deletedCount,
					},
				});
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
			))
		)
			return errorResponse("Device not found", 404);
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
			))
		)
			return errorResponse("Device not found", 404);
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
		await executeBatch(c.get("dbDialect"), [
			db.deleteFrom("refresh_tokens").where("user_id", "=", userId).compile(),
			db.deleteFrom("devices").where("user_id", "=", userId).compile(),
			db
				.updateTable("users")
				.set({
					security_stamp: crypto.randomUUID(),
					updated_at: Math.floor(Date.now() / 1000),
				})
				.where("id", "=", userId)
				.compile(),
		]);
		invalidateUserCache(userId);
		return new Response(null, { status: 200 });
	},
);
