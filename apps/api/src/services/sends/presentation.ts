import { safeParseJsonWithSchema } from "@edgewarden/shared";
import type { Kysely, Selectable } from "kysely";
import * as v from "valibot";
import type { DB, Sends } from "../../types/db";
import { decodeBase64Url, encodeBase64Url } from "../../utils/base64-url";
import { now } from "../../utils/time";
import * as usersDb from "../db/users";

function uuidToBytes(uuid: string): Uint8Array | null {
	const hex = uuid.replace(/-/g, "").toLowerCase();
	if (!/^[0-9a-f]{32}$/.test(hex)) return null;
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 16; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function bytesToUuid(bytes: Uint8Array): string | null {
	if (bytes.length !== 16) return null;
	const hex = Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join("-");
}

export function toAccessId(sendId: string): string {
	const bytes = uuidToBytes(sendId);
	return bytes ? encodeBase64Url(bytes) : "";
}

export function fromAccessId(accessId: string): string | null {
	const bytes = decodeBase64Url(accessId);
	return bytes?.length === 16 ? bytesToUuid(bytes) : null;
}

type StoredSend = Selectable<Sends>;
const StoredSendDataSchema = v.record(v.string(), v.unknown());
const SendEmailsStorageSchema = v.array(v.string());

export function isSendAvailable(send: StoredSend): boolean {
	const timestamp = now();
	return !(
		(send.max_access_count !== null &&
			send.access_count >= send.max_access_count) ||
		(send.expiration_date && timestamp >= send.expiration_date) ||
		(send.deletion_date && timestamp >= send.deletion_date) ||
		send.disabled === 1
	);
}

export function parseStoredSendData(
	send: Pick<StoredSend, "data">,
): Record<string, unknown> {
	const parsed = safeParseJsonWithSchema(send.data, StoredSendDataSchema);
	if (!parsed) return {};
	const data = { ...parsed };
	if (data.id === undefined && data.Id !== undefined) data.id = data.Id;
	if (data.size === undefined && data.Size !== undefined) data.size = data.Size;
	if (data.sizeName === undefined && data.SizeName !== undefined)
		data.sizeName = data.SizeName;
	if (data.fileName === undefined && data.FileName !== undefined)
		data.fileName = data.FileName;
	return data;
}

export function serializeSendEmails(
	emails: string[] | null | undefined,
): string | null {
	return emails?.length ? JSON.stringify(emails) : null;
}

function parseSendEmails(emails: string | null): string[] | null {
	if (!emails) return null;
	return safeParseJsonWithSchema(emails, SendEmailsStorageSchema);
}

export function parseInteger(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const number = Number(value);
	return Number.isInteger(number) ? number : null;
}

export function parseDateSeconds(value: unknown): number | null {
	if (!value || typeof value !== "string") return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? null
		: Math.floor(date.getTime() / 1000);
}

function formatIso(timestamp: number | null | undefined): string | null {
	return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

export function sendToResponse(send: StoredSend) {
	const data = parseStoredSendData(send);
	return {
		id: send.id,
		accessId: toAccessId(send.id),
		type: Number(send.type) || 0,
		name: send.name,
		notes: send.notes,
		text: send.type === 0 ? data : null,
		file: send.type === 1 ? data : null,
		key: send.key,
		maxAccessCount: send.max_access_count,
		accessCount: send.access_count,
		password: send.password_hash ? "true" : null,
		emails: parseSendEmails(send.emails),
		authType: send.auth_type,
		disabled: send.disabled === 1,
		hideEmail: send.hide_email === 1,
		revisionDate: formatIso(send.updated_at),
		expirationDate: formatIso(send.expiration_date),
		deletionDate: formatIso(send.deletion_date),
		object: "send",
	};
}

export async function getCreatorIdentifier(
	db: Kysely<DB>,
	send: StoredSend,
): Promise<string | null> {
	if (send.hide_email === 1 || !send.user_id) return null;
	const user = await usersDb.getUserById(db, send.user_id);
	return user?.email ?? null;
}

export function sendToAccessResponse(
	send: StoredSend,
	creatorIdentifier: string | null,
) {
	const data = parseStoredSendData(send);
	return {
		id: send.id,
		type: Number(send.type) || 0,
		name: send.name,
		text: send.type === 0 ? data : null,
		file: send.type === 1 ? data : null,
		expirationDate: formatIso(send.expiration_date),
		deletionDate: formatIso(send.deletion_date),
		creatorIdentifier,
		object: "send-access",
	};
}
