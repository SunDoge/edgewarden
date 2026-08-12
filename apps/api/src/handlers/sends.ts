import { vValidator } from "@hono/valibot-validator";
import { factory } from "../http/factory";
import { BulkIdsSchema } from "../schemas/ciphers";
import { CreateTextSendSchema, UpdateSendSchema } from "../schemas/sends";
import { auditRequestMetadata, safeWriteAuditEvent } from "../services/audit";
import { executeBatch, revisionQuery } from "../services/db/batch";
import { textColumnInJson } from "../services/db/json-array";
import * as sendsDb from "../services/db/sends";
import { setSendPassword } from "../services/sends/password";
import {
	parseDateSeconds,
	parseInteger,
	parseStoredSendData,
	sendToResponse,
	serializeSendEmails,
} from "../services/sends/presentation";
import { errorResponse } from "../utils/response";
import { now } from "../utils/time";

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

		const ts = now();
		await executeBatch(c.get("dbDialect"), [
			db
				.updateTable("sends")
				.set({ deletion_date: ts, updated_at: ts })
				.where(textColumnInJson("id", ids))
				.where("user_id", "=", user.id)
				.compile(),
			revisionQuery(db, user.id, ts),
		]);
		await safeWriteAuditEvent(db, {
			actorUserId: user.id,
			action: "send.delete.bulk",
			category: "vault",
			targetType: "send",
			metadata: { ...auditRequestMetadata(c.req.raw), size: ids.length },
		});
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

	const ts = now();
	await executeBatch(c.get("dbDialect"), [
		db
			.updateTable("sends")
			.set({ deletion_date: ts, updated_at: ts })
			.where("id", "=", sendId)
			.where("user_id", "=", user.id)
			.compile(),
		revisionQuery(db, user.id, ts),
	]);
	await safeWriteAuditEvent(db, {
		actorUserId: user.id,
		action: "send.delete",
		category: "vault",
		targetType: "send",
		targetId: sendId,
		metadata: auditRequestMetadata(c.req.raw),
	});
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

export {
	accessPublicSend,
	accessPublicSendFile,
	accessSendFileWithToken,
	accessSendWithToken,
	downloadSendFile,
	uploadPublicSendFile,
} from "./sends-public";

export {
	createFileSend,
	getSendFileUpload,
	uploadSendFile,
} from "./sends-file";
