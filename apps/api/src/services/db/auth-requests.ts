import type { Kysely, Selectable } from "kysely";
import type { DB, AuthRequests } from "../../types/db";
import { now } from "../../utils/time";

// Auth requests expire after 15 minutes
const AUTH_REQUEST_TTL_SECONDS = 15 * 60;

export function isAuthRequestExpired(req: Selectable<AuthRequests>): boolean {
	return req.creation_date + AUTH_REQUEST_TTL_SECONDS < now();
}

export async function createAuthRequest(
	db: Kysely<DB>,
	data: {
		id: string;
		userId: string;
		type: number;
		requestDeviceIdentifier: string;
		requestDeviceType: number;
		requestIpAddress: string | null;
		accessCode: string;
		publicKey: string;
	},
): Promise<void> {
	await db
		.insertInto("auth_requests")
		.values({
			id: data.id,
			user_id: data.userId,
			type: data.type,
			request_device_identifier: data.requestDeviceIdentifier,
			request_device_type: data.requestDeviceType,
			request_ip_address: data.requestIpAddress,
			access_code: data.accessCode,
			public_key: data.publicKey,
			creation_date: now(),
		})
		.execute();
}

export async function getAuthRequestById(
	db: Kysely<DB>,
	id: string,
): Promise<Selectable<AuthRequests> | null> {
	return (
		(await db
			.selectFrom("auth_requests")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirst()) ?? null
	);
}

export async function getPendingAuthRequestsForDevice(
	db: Kysely<DB>,
	userId: string,
	deviceIdentifier: string,
): Promise<Selectable<AuthRequests>[]> {
	const cutoff = now() - AUTH_REQUEST_TTL_SECONDS;
	return db
		.selectFrom("auth_requests")
		.selectAll()
		.where("user_id", "=", userId)
		.where("request_device_identifier", "=", deviceIdentifier)
		.where("approved", "is", null)
		.where("creation_date", ">", cutoff)
		.orderBy("creation_date", "desc")
		.execute();
}

export async function approveAuthRequest(
	db: Kysely<DB>,
	id: string,
	responseDeviceIdentifier: string,
	key: string | null,
	masterPasswordHash: string | null,
): Promise<void> {
	await db
		.updateTable("auth_requests")
		.set({
			approved: 1,
			response_device_identifier: responseDeviceIdentifier,
			key,
			master_password_hash: masterPasswordHash,
			response_date: now(),
		})
		.where("id", "=", id)
		.execute();
}

export async function markAuthRequestAuthenticated(
	db: Kysely<DB>,
	id: string,
): Promise<void> {
	await db
		.updateTable("auth_requests")
		.set({ authentication_date: now() })
		.where("id", "=", id)
		.execute();
}
