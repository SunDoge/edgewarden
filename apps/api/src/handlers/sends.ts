import { vValidator } from "@hono/valibot-validator";
import { LIMITS } from "../config";
import { factory } from "../http/factory";
import { BulkIdsSchema } from "../schemas/ciphers";
import {
	CreateFileSendSchema,
	CreateTextSendSchema,
	SendAccessSchema,
	UpdateSendSchema,
} from "../schemas/sends";
import {
	deleteBlobObject,
	getBlobObject,
	getBlobStorageMaxBytes,
	getSendFileObjectKey,
	putBlobObject,
} from "../services/blob-store";
import { executeBatch, revisionQuery } from "../services/db/batch";
import * as revisionsDb from "../services/db/revisions";
import * as sendsDb from "../services/db/sends";
import * as usersDb from "../services/db/users";
import {
	buildDirectUploadUrl,
	parseDirectUploadPayload,
} from "../utils/direct-upload";
import {
	createSendFileDownloadToken,
	createSendFileUploadToken,
	verifySendAccessToken,
	verifySendFileDownloadToken,
	verifySendFileUploadToken,
} from "../utils/jwt";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";

// ── Sends Cryptographic Helper Functions ────────────────────────────────────

function uuidToBytes(uuid: string): Uint8Array | null {
	const hex = uuid.replace(/-/g, "").toLowerCase();
	if (!/^[0-9a-f]{32}$/.test(hex)) return null;
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 16; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function bytesToUuid(bytes: Uint8Array): string | null {
	if (bytes.length !== 16) return null;
	const hex = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join("-");
}

function base64UrlEncode(data: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < data.length; i++) {
		bin += String.fromCharCode(data[i]);
	}
	const base64 = btoa(bin);
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array | null {
	try {
		let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
		while (normalized.length % 4) normalized += "=";
		const raw = atob(normalized);
		const out = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

export function toAccessId(sendId: string): string {
	const bytes = uuidToBytes(sendId);
	if (!bytes) return "";
	return base64UrlEncode(bytes);
}

export function fromAccessId(accessId: string): string | null {
	const bytes = base64UrlDecode(accessId);
	if (!bytes || bytes.length !== 16) return null;
	return bytesToUuid(bytes);
}

function isSendAvailable(send: any): boolean {
	const nowTs = now();

	if (
		send.max_access_count !== null &&
		send.access_count >= send.max_access_count
	) {
		return false;
	}

	if (send.expiration_date && nowTs >= send.expiration_date) {
		return false;
	}

	if (send.deletion_date && nowTs >= send.deletion_date) {
		return false;
	}

	if (send.disabled === 1) {
		return false;
	}

	return true;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a[i] ^ b[i];
	}
	return diff === 0;
}

async function deriveSendPasswordHash(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		{ name: "PBKDF2" },
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt,
			iterations,
			hash: "SHA-256",
		},
		key,
		256,
	);
	return new Uint8Array(bits);
}

async function verifySendPassword(
	send: any,
	password: string,
): Promise<boolean> {
	if (!send.password_hash) return false;

	if (!send.password_salt || !send.password_iterations) {
		return verifySendPasswordHashB64(send, password);
	}

	const salt = base64UrlDecode(send.password_salt);
	const expected = base64UrlDecode(send.password_hash);
	if (!salt || !expected) return false;

	const actual = await deriveSendPasswordHash(
		password,
		salt,
		send.password_iterations,
	);
	return constantTimeEqual(actual, expected);
}

function verifySendPasswordHashB64(
	send: any,
	passwordHashB64: string,
): boolean {
	if (!send.password_hash || !passwordHashB64) return false;
	const expected = base64UrlDecode(send.password_hash);
	const provided = base64UrlDecode(passwordHashB64);
	if (!expected || !provided) return false;
	return constantTimeEqual(expected, provided);
}

async function setSendPassword(
	send: any,
	password: string | null,
): Promise<void> {
	if (!password) {
		send.password_hash = null;
		send.password_salt = null;
		send.password_iterations = null;
		send.password_algorithm = null;
		if (send.auth_type === 1) {
			send.auth_type = 2; // None
		}
		return;
	}

	const salt = crypto.getRandomValues(new Uint8Array(64));
	const hash = await deriveSendPasswordHash(password, salt, 100000);

	send.password_salt = base64UrlEncode(salt);
	send.password_hash = base64UrlEncode(hash);
	send.password_iterations = 100000;
	send.password_algorithm = "pbkdf2-sha256";
	send.auth_type = 1; // Password
}

function getSafeJwtSecret(env: CloudflareBindings): string | null {
	const secret = (env.JWT_SECRET || "").trim();
	if (!secret || secret.length < LIMITS.auth.jwtSecretMinLength) {
		return null;
	}
	return secret;
}

function parseStoredSendData(send: any): Record<string, unknown> {
	try {
		return JSON.parse(send.data);
	} catch {
		return {};
	}
}

function serializeSendEmails(
	emails: string[] | null | undefined,
): string | null {
	return emails?.length ? JSON.stringify(emails) : null;
}

function parseSendEmails(emails: string | null): string[] | null {
	if (!emails) return null;
	try {
		const parsed = JSON.parse(emails);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function parseInteger(val: any): number | null {
	if (val === null || val === undefined || val === "") return null;
	const num = Number(val);
	return Number.isInteger(num) ? num : null;
}

function parseDateSeconds(val: any): number | null {
	if (!val || typeof val !== "string") return null;
	const date = new Date(val);
	return Number.isNaN(date.getTime())
		? null
		: Math.floor(date.getTime() / 1000);
}

function formatIso(ts: number | null | undefined): string | null {
	if (!ts) return null;
	return new Date(ts * 1000).toISOString();
}

function sendToResponse(send: any) {
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

async function getCreatorIdentifier(
	db: any,
	send: any,
): Promise<string | null> {
	if (send.hide_email === 1) return null;
	if (!send.user_id) return null;
	const user = await usersDb.getUserById(db, send.user_id);
	return user?.email ?? null;
}

function sendToAccessResponse(send: any, creatorIdentifier: string | null) {
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

// ── Authenticated sends router (private APIs) ───────────────────────────────

export const listSends = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const user = c.get("user");
	const list = await sendsDb.getSendsByUserId(db, user.id);
	return c.json({
		data: list.map(sendToResponse),
		object: "list",
		continuationToken: null,
	});
});

export const getSend = factory.createHandlers(async (c) => {
	return c.json(sendToResponse(c.get("send")));
});

export const createTextSend = factory.createHandlers(
	vValidator("json", CreateTextSendSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");

		const body = c.req.valid("json");
		const type = parseInteger(body.type ?? body.Type);
		if (type !== 0 && type !== 1) {
			return errorResponse("Invalid Send type", 400);
		}
		if (type === 1) {
			return errorResponse("File sends should use /api/sends/file/v2", 400);
		}

		const name = String(body.name ?? body.Name ?? "").trim();
		const key = String(body.key ?? body.Key ?? "").trim();
		if (!name || !key) {
			return errorResponse("Name and Key are required", 400);
		}

		const deletionDate = parseDateSeconds(
			body.deletionDate ?? body.DeletionDate,
		);
		if (!deletionDate) {
			return errorResponse("Invalid deletionDate", 400);
		}

		const textData = body.text ?? body.Text;
		if (!textData) {
			return errorResponse("Send data not provided", 400);
		}

		const maxAccess = parseInteger(body.maxAccessCount ?? body.MaxAccessCount);
		const expirationDate = parseDateSeconds(
			body.expirationDate ?? body.ExpirationDate,
		);
		const disabled = (body.disabled ?? body.Disabled) === true ? 1 : 0;
		const hideEmail = (body.hideEmail ?? body.HideEmail) === true ? 1 : 0;
		const notes = body.notes ?? body.Notes ?? null;
		const password = body.password ?? body.Password ?? null;
		const authType = parseInteger(body.authType ?? body.AuthType) ?? 2;

		const ts = now();
		const send: any = {
			id: crypto.randomUUID(),
			user_id: user.id,
			org_id: null,
			type,
			name,
			notes,
			data: JSON.stringify(textData),
			key,
			password_hash: null,
			password_salt: null,
			password_iterations: null,
			password_algorithm: null,
			auth_type: authType,
			emails: serializeSendEmails(body.emails),
			max_access_count: maxAccess,
			access_count: 0,
			disabled,
			hide_email: hideEmail,
			created_at: ts,
			updated_at: ts,
			expiration_date: expirationDate,
			deletion_date: deletionDate,
		};

		if (typeof password === "string" && password.length > 0) {
			await setSendPassword(send, password);
		}

		await executeBatch(c.get("dbDialect"), [
			db.insertInto("sends").values(send).compile(),
			revisionQuery(db, user.id, ts),
		]);

		return c.json(sendToResponse(send));
	},
);

export const createFileSend = factory.createHandlers(
	vValidator("json", CreateFileSendSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const secret = getSafeJwtSecret(c.env);
		if (!secret) return errorResponse("Server configuration error", 500);

		const body = c.req.valid("json");
		const type = parseInteger(body.type ?? body.Type);
		if (type !== 1) {
			return errorResponse("Send content is not a file", 400);
		}

		const fileLength = parseInteger(body.fileLength ?? body.FileLength);
		if (fileLength === null || fileLength < 0) {
			return errorResponse("Invalid send length", 400);
		}
		const maxFileSize = getBlobStorageMaxBytes(
			c.env,
			LIMITS.send.maxFileSizeBytes,
		);
		if (fileLength > maxFileSize) {
			return errorResponse("Send storage limit exceeded with this file", 400);
		}

		const name = String(body.name ?? body.Name ?? "").trim();
		const key = String(body.key ?? body.Key ?? "").trim();
		if (!name || !key) {
			return errorResponse("Name and Key are required", 400);
		}

		const deletionDate = parseDateSeconds(
			body.deletionDate ?? body.DeletionDate,
		);
		if (!deletionDate) {
			return errorResponse("Invalid deletionDate", 400);
		}

		const fileRaw = body.file ?? body.File;
		if (!fileRaw) {
			return errorResponse("Send data not provided", 400);
		}

		const fileId = crypto.randomUUID();
		const fileData = {
			id: fileId,
			size: fileLength,
			sizeName:
				fileRaw.sizeName || `${(fileLength / 1024 / 1024).toFixed(2)} MB`,
			fileName: fileRaw.fileName || name,
		};

		const maxAccess = parseInteger(body.maxAccessCount ?? body.MaxAccessCount);
		const expirationDate = parseDateSeconds(
			body.expirationDate ?? body.ExpirationDate,
		);
		const disabled = (body.disabled ?? body.Disabled) === true ? 1 : 0;
		const hideEmail = (body.hideEmail ?? body.HideEmail) === true ? 1 : 0;
		const notes = body.notes ?? body.Notes ?? null;
		const password = body.password ?? body.Password ?? null;
		const authType = parseInteger(body.authType ?? body.AuthType) ?? 2;

		const ts = now();
		const sendId = crypto.randomUUID();
		const send: any = {
			id: sendId,
			user_id: user.id,
			org_id: null,
			type: 1,
			name,
			notes,
			data: JSON.stringify(fileData),
			key,
			password_hash: null,
			password_salt: null,
			password_iterations: null,
			password_algorithm: null,
			auth_type: authType,
			emails: serializeSendEmails(body.emails),
			max_access_count: maxAccess,
			access_count: 0,
			disabled,
			hide_email: hideEmail,
			created_at: ts,
			updated_at: ts,
			expiration_date: expirationDate,
			deletion_date: deletionDate,
		};

		if (typeof password === "string" && password.length > 0) {
			await setSendPassword(send, password);
		}

		await executeBatch(c.get("dbDialect"), [
			db.insertInto("sends").values(send).compile(),
			revisionQuery(db, user.id, ts),
		]);

		const uploadToken = await createSendFileUploadToken(
			user.id,
			send.id,
			fileId,
			secret,
		);

		return c.json({
			fileUploadType: 1,
			object: "send-fileUpload",
			url: buildDirectUploadUrl(
				c.req.raw,
				`/api/sends/${send.id}/file/${fileId}`,
				uploadToken,
			),
			sendResponse: sendToResponse(send),
		});
	},
);

export const deleteSends = factory.createHandlers(
	vValidator("json", BulkIdsSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const body = c.req.valid("json");
		const ids = body.ids;
		if (!Array.isArray(ids)) {
			return errorResponse("ids array is required", 400);
		}

		for (const id of ids) {
			const send = await sendsDb.getSendById(db, id);
			if (send && send.user_id === user.id) {
				if (send.type === 1) {
					const fileData = parseStoredSendData(send);
					if (fileData.id) {
						await deleteBlobObject(
							c.env,
							getSendFileObjectKey(send.id, String(fileData.id)),
						);
					}
				}
			}
		}
		await executeBatch(c.get("dbDialect"), [
			db
				.deleteFrom("sends")
				.where("id", "in", ids)
				.where("user_id", "=", user.id)
				.compile(),
			revisionQuery(db, user.id),
		]);
		return new Response(null, { status: 200 });
	},
);

export const updateSend = factory.createHandlers(
	vValidator("json", UpdateSendSchema),
	async (c) => {
		const db = c.get("db");
		const user = c.get("user");
		const send = c.get("send");
		const sendId = send.id;

		const body = c.req.valid("json");
		const name = body.name ?? body.Name;
		const key = body.key ?? body.Key;
		const deletionDate = parseDateSeconds(
			body.deletionDate ?? body.DeletionDate,
		);
		const expirationDate =
			Object.hasOwn(body, "expirationDate") ||
			Object.hasOwn(body, "ExpirationDate")
				? parseDateSeconds(body.expirationDate ?? body.ExpirationDate)
				: undefined;
		const disabled =
			(body.disabled ?? body.Disabled) !== undefined
				? (body.disabled ?? body.Disabled) === true
					? 1
					: 0
				: undefined;
		const hideEmail =
			(body.hideEmail ?? body.HideEmail) !== undefined
				? (body.hideEmail ?? body.HideEmail) === true
					? 1
					: 0
				: undefined;
		const notes =
			Object.hasOwn(body, "notes") || Object.hasOwn(body, "Notes")
				? (body.notes ?? body.Notes ?? null)
				: undefined;
		const password = body.password ?? body.Password;
		const authType = parseInteger(body.authType ?? body.AuthType);
		const textData = body.text ?? body.Text;

		const updateData: any = {};
		if (name !== undefined) updateData.name = String(name).trim();
		if (key !== undefined) updateData.key = String(key).trim();
		if (deletionDate !== null && deletionDate !== undefined)
			updateData.deletion_date = deletionDate;
		if (expirationDate !== undefined)
			updateData.expiration_date = expirationDate;
		if (disabled !== undefined) updateData.disabled = disabled;
		if (hideEmail !== undefined) updateData.hide_email = hideEmail;
		if (notes !== undefined) updateData.notes = notes;
		if (authType !== null && authType !== undefined)
			updateData.auth_type = authType;
		if (body.emails !== undefined) {
			updateData.emails = serializeSendEmails(body.emails);
		}
		if (textData !== undefined) {
			if (send.type !== 0)
				return errorResponse("Only text Sends can update text data", 400);
			updateData.data = JSON.stringify(textData);
		}

		if (password !== undefined) {
			const sendCopy = { ...send };
			await setSendPassword(sendCopy, password);
			updateData.password_hash = sendCopy.password_hash;
			updateData.password_salt = sendCopy.password_salt;
			updateData.password_iterations = sendCopy.password_iterations;
			updateData.password_algorithm = sendCopy.password_algorithm;
			updateData.auth_type = sendCopy.auth_type;
		}

		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("sends")
				.set({ ...updateData, updated_at: ts })
				.where("id", "=", sendId)
				.where("user_id", "=", user.id)
				.compile(),
			revisionQuery(db, user.id, ts),
		]);

		const updated = await sendsDb.getSendById(db, sendId);
		if (!updated) return errorResponse("Send not found", 404);
		return c.json(sendToResponse(updated));
	},
);

export const deleteSend = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const user = c.get("user");
	const send = c.get("send");
	const sendId = send.id;

	if (send.type === 1) {
		const fileData = parseStoredSendData(send);
		if (fileData.id) {
			await deleteBlobObject(
				c.env,
				getSendFileObjectKey(send.id, String(fileData.id)),
			);
		}
	}

	await executeBatch(c.get("dbDialect"), [
		db
			.deleteFrom("sends")
			.where("id", "=", sendId)
			.where("user_id", "=", user.id)
			.compile(),
		revisionQuery(db, user.id),
	]);
	return new Response(null, { status: 200 });
});

export const removeSendPassword = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const user = c.get("user");
	const send = c.get("send");
	const sendId = send.id;

	const sendCopy = { ...send };
	await setSendPassword(sendCopy, null);

	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db
			.updateTable("sends")
			.set({
				password_hash: null,
				password_salt: null,
				password_iterations: null,
				password_algorithm: null,
				auth_type: sendCopy.auth_type,
				updated_at: ts,
			})
			.where("id", "=", sendId)
			.where("user_id", "=", user.id)
			.compile(),
		revisionQuery(db, user.id, ts),
	]);

	const updated = await sendsDb.getSendById(db, sendId);
	if (!updated) return errorResponse("Send not found", 404);
	return c.json(sendToResponse(updated));
});

export const removeSendAuth = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const user = c.get("user");
	const send = c.get("send");
	const sendId = send.id;

	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db
			.updateTable("sends")
			.set({ auth_type: 2, emails: null, updated_at: ts })
			.where("id", "=", sendId)
			.where("user_id", "=", user.id)
			.compile(),
		revisionQuery(db, user.id, ts),
	]);

	const updated = await sendsDb.getSendById(db, sendId);
	if (!updated) return errorResponse("Send not found", 404);
	return c.json(sendToResponse(updated));
});

export const getSendFileUpload = factory.createHandlers(async (c) => {
	const user = c.get("user");
	const secret = getSafeJwtSecret(c.env);
	if (!secret) return errorResponse("Server configuration error", 500);

	const send = c.get("send");

	const fileId = c.get("sendFileId");
	const uploadToken = await createSendFileUploadToken(
		user.id,
		send.id,
		fileId,
		secret,
	);

	return c.json({
		fileUploadType: 1,
		object: "send-fileUpload",
		url: buildDirectUploadUrl(
			c.req.raw,
			`/api/sends/${send.id}/file/${fileId}`,
			uploadToken,
		),
		sendResponse: sendToResponse(send),
	});
});

export const uploadSendFile = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const user = c.get("user");
	const send = c.get("send");

	const fileId = c.get("sendFileId");
	const maxFileSize = getBlobStorageMaxBytes(
		c.env,
		LIMITS.send.maxFileSizeBytes,
	);
	const sendData = parseStoredSendData(send);

	const upload = await parseDirectUploadPayload(c.req.raw, {
		expectedSize: parseInteger(sendData.size),
		expectedFileName: String(sendData.fileName || ""),
		maxFileSize,
		tooLargeMessage: "Send storage limit exceeded with this file",
	});

	if (upload instanceof Response) {
		return upload;
	}

	await putBlobObject(
		c.env,
		getSendFileObjectKey(send.id, fileId),
		upload.body,
		{
			size: upload.size,
			contentType: upload.contentType,
			customMetadata: {
				sendId: send.id,
				fileId,
			},
		},
	);

	await revisionsDb.touchRevision(db, user.id);
	return new Response(null, { status: 201 });
});

// ── Public sends router (unauthenticated APIs) ───────────────────────────────

export const accessPublicSend = factory.createHandlers(
	vValidator("json", SendAccessSchema),
	async (c) => {
		const db = c.get("db");
		const idOrAccessId = c.req.param("idOrAccessId") ?? "";
		const sendId = fromAccessId(idOrAccessId) || idOrAccessId;

		const send = await sendsDb.getSendById(db, sendId);
		if (!send || !isSendAvailable(send)) {
			return errorResponse(
				"Send does not exist or is no longer available",
				404,
			);
		}

		const body = c.req.valid("json");
		if (send.password_hash) {
			const password = body.password ?? body.Password;
			const passwordHashB64 =
				body.passwordHash ?? body.PasswordHash ?? body.password_hash_b64;

			let ok = false;
			if (password) {
				ok = await verifySendPassword(send, password);
			} else if (passwordHashB64) {
				ok = verifySendPasswordHashB64(send, passwordHashB64);
			}

			if (!ok) {
				return errorResponse("Invalid password", 401);
			}
		}

		if (send.type === 0) {
			await sendsDb.incrementAccessCount(db, send.id);
		}

		const creatorIdentifier = await getCreatorIdentifier(db, send);
		return c.json(sendToAccessResponse(send, creatorIdentifier));
	},
);

export const accessSendWithToken = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const secret = getSafeJwtSecret(c.env);
	if (!secret) return errorResponse("Server configuration error", 500);

	const auth = c.req.header("Authorization") || "";
	const token = auth.replace(/^Bearer\s+/i, "").trim();
	if (!token) return errorResponse("Unauthorized", 401);

	const claims = await verifySendAccessToken(token, secret);
	if (!claims) return errorResponse("Unauthorized", 401);

	const send = await sendsDb.getSendById(db, claims.sub);
	if (!send || !isSendAvailable(send)) {
		return errorResponse("Send does not exist or is no longer available", 404);
	}

	if (send.type === 0) {
		await sendsDb.incrementAccessCount(db, send.id);
	}

	const creatorIdentifier = await getCreatorIdentifier(db, send);
	return c.json(sendToAccessResponse(send, creatorIdentifier));
});

export const accessSendFileWithToken = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const secret = getSafeJwtSecret(c.env);
	if (!secret) return errorResponse("Server configuration error", 500);

	const auth = c.req.header("Authorization") || "";
	const token = auth.replace(/^Bearer\s+/i, "").trim();
	if (!token) return errorResponse("Unauthorized", 401);

	const claims = await verifySendAccessToken(token, secret);
	if (!claims) return errorResponse("Unauthorized", 401);

	const send = await sendsDb.getSendById(db, claims.sub);
	if (!send || !isSendAvailable(send) || send.type !== 1) {
		return errorResponse("Send does not exist or is no longer available", 404);
	}

	const fileId = c.req.param("fileId");
	const fileData = parseStoredSendData(send);
	if (String(fileData.id || "") !== fileId) {
		return errorResponse("Send file does not match send data.", 400);
	}

	await sendsDb.incrementAccessCount(db, send.id);

	const downloadToken = await createSendFileDownloadToken(
		send.id,
		fileId,
		secret,
	);
	const url = new URL(c.req.url);
	const downloadUrl = `${url.origin}/api/sends/${send.id}/${fileId}?t=${downloadToken}`;

	return c.json({
		object: "send-fileDownload",
		id: fileId,
		url: downloadUrl,
	});
});

export const accessPublicSendFile = factory.createHandlers(
	vValidator("json", SendAccessSchema),
	async (c) => {
		const db = c.get("db");
		const secret = getSafeJwtSecret(c.env);
		if (!secret) return errorResponse("Server configuration error", 500);

		const idOrAccessId = c.req.param("idOrAccessId") ?? "";
		const sendId = fromAccessId(idOrAccessId) || idOrAccessId;

		const send = await sendsDb.getSendById(db, sendId);
		if (!send || !isSendAvailable(send) || send.type !== 1) {
			return errorResponse(
				"Send does not exist or is no longer available",
				404,
			);
		}

		const fileId = c.req.param("fileId");
		const fileData = parseStoredSendData(send);
		if (String(fileData.id || "") !== fileId) {
			return errorResponse("Send file does not match send data.", 400);
		}

		const body = c.req.valid("json");
		if (send.password_hash) {
			const password = body.password ?? body.Password;
			const passwordHashB64 =
				body.passwordHash ?? body.PasswordHash ?? body.password_hash_b64;

			let ok = false;
			if (password) {
				ok = await verifySendPassword(send, password);
			} else if (passwordHashB64) {
				ok = verifySendPasswordHashB64(send, passwordHashB64);
			}

			if (!ok) {
				return errorResponse("Invalid password", 401);
			}
		}

		await sendsDb.incrementAccessCount(db, send.id);

		const downloadToken = await createSendFileDownloadToken(
			send.id,
			fileId,
			secret,
		);
		const url = new URL(c.req.url);
		const downloadUrl = `${url.origin}/api/sends/${send.id}/${fileId}?t=${downloadToken}`;

		return c.json({
			object: "send-fileDownload",
			id: fileId,
			url: downloadUrl,
		});
	},
);

export const downloadSendFile = factory.createHandlers(async (c) => {
	const secret = getSafeJwtSecret(c.env);
	if (!secret) return errorResponse("Server configuration error", 500);

	const token = c.req.query("t") || c.req.query("token");
	if (!token) return errorResponse("Token required", 401);

	const claims = await verifySendFileDownloadToken(token, secret);
	if (!claims) return errorResponse("Invalid or expired token", 401);

	const idOrAccessId = c.req.param("idOrAccessId") ?? "";
	const sendId = fromAccessId(idOrAccessId) || idOrAccessId;
	const fileId = c.req.param("fileId");

	if (claims.sendId !== sendId || claims.fileId !== fileId) {
		return errorResponse("Token mismatch", 401);
	}

	const object = await getBlobObject(
		c.env,
		getSendFileObjectKey(sendId, fileId),
	);
	if (!object) {
		return errorResponse("Send file not found", 404);
	}

	c.header("Content-Type", object.contentType || "application/octet-stream");
	c.header("Content-Length", String(object.size));
	c.header("Cache-Control", "private, no-cache");

	return c.body(object.body as any);
});

export const uploadPublicSendFile = factory.createHandlers(async (c) => {
	const db = c.get("db");
	const secret = getSafeJwtSecret(c.env);
	if (!secret) return errorResponse("Server configuration error", 500);

	const token = c.req.query("token") || c.req.query("t");
	if (!token) return errorResponse("Token required", 401);

	const claims = await verifySendFileUploadToken(token, secret);
	if (!claims) return errorResponse("Invalid or expired token", 401);

	const sendId = c.req.param("id");
	const fileId = c.req.param("fileId");
	if (claims.sendId !== sendId || claims.fileId !== fileId) {
		return errorResponse("Token mismatch", 401);
	}

	const send = await sendsDb.getSendById(db, sendId);
	if (!send || send.user_id !== claims.userId) {
		return errorResponse("Send not found. Unable to save the file.", 404);
	}

	const maxFileSize = getBlobStorageMaxBytes(
		c.env,
		LIMITS.send.maxFileSizeBytes,
	);
	const sendData = parseStoredSendData(send);

	const upload = await parseDirectUploadPayload(c.req.raw, {
		expectedSize: parseInteger(sendData.size),
		expectedFileName: String(sendData.fileName || ""),
		maxFileSize,
		tooLargeMessage: "Send storage limit exceeded with this file",
	});

	if (upload instanceof Response) {
		return upload;
	}

	await putBlobObject(
		c.env,
		getSendFileObjectKey(send.id, fileId),
		upload.body,
		{
			size: upload.size,
			contentType: upload.contentType,
			customMetadata: {
				sendId: send.id,
				fileId,
			},
		},
	);

	await revisionsDb.touchRevision(db, claims.userId);
	return new Response(null, { status: 201 });
});
