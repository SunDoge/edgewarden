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
import { textColumnInJson } from "../services/db/json-array";
import * as revisionsDb from "../services/db/revisions";
import * as sendsDb from "../services/db/sends";
import {
	setSendPassword,
	verifySendPassword,
	verifySendPasswordHashB64,
} from "../services/sends/password";
import {
	fromAccessId,
	getCreatorIdentifier,
	isSendAvailable,
	parseDateSeconds,
	parseInteger,
	parseStoredSendData,
	sendToAccessResponse,
	sendToResponse,
	serializeSendEmails,
} from "../services/sends/presentation";
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

function getSafeJwtSecret(env: CloudflareBindings): string | null {
	const secret = (env.JWT_SECRET || "").trim();
	if (!secret || secret.length < LIMITS.auth.jwtSecretMinLength) {
		return null;
	}
	return secret;
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

		const fileSends = await db
			.selectFrom("sends")
			.select(["id", "data"])
			.where("user_id", "=", user.id)
			.where("type", "=", 1)
			.where(textColumnInJson("id", ids))
			.execute();
		const objectKeys = fileSends.flatMap((send) => {
			const fileId = parseStoredSendData(send).id;
			return fileId ? [getSendFileObjectKey(send.id, String(fileId))] : [];
		});
		await executeBatch(c.get("dbDialect"), [
			db
				.deleteFrom("sends")
				.where(textColumnInJson("id", ids))
				.where("user_id", "=", user.id)
				.compile(),
			revisionQuery(db, user.id),
		]);
		await Promise.allSettled(
			objectKeys.map((key) => deleteBlobObject(c.env, key)),
		);
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
