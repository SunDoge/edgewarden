import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../env";
import * as authRequestsDb from "../services/db/auth-requests";
import * as ciphersDb from "../services/db/ciphers";
import * as devicesDb from "../services/db/devices";
import * as foldersDb from "../services/db/folders";
import * as sendsDb from "../services/db/sends";
import * as webauthnDb from "../services/db/webauthn";
import { textColumnInJson } from "../services/db/json-array";
import { parseStoredSendFileMetadata } from "../services/sends/file-metadata";
import { errorResponse } from "../utils/response";

export const requireFolder = createMiddleware<HonoEnv>(async (c, next) => {
	const id = c.req.param("id");
	if (!id) return errorResponse("Not found", 404);
	const folder = await foldersDb.getFolderById(
		c.get("db"),
		id,
		c.get("user").id,
	);
	if (!folder) return errorResponse("Not found", 404);
	c.set("folder", folder);
	await next();
});

export const requireDevice = createMiddleware<HonoEnv>(async (c, next) => {
	const id = c.req.param("id");
	if (!id) return errorResponse("Not found", 404);
	const device = await devicesDb.getDevice(c.get("db"), c.get("user").id, id);
	if (!device) return errorResponse("Not found", 404);
	c.set("device", device);
	await next();
});

export const requireAuthRequest = createMiddleware<HonoEnv>(async (c, next) => {
	const id = c.req.param("id");
	if (!id) return errorResponse("Not found", 404);
	const authRequest = await authRequestsDb.getAuthRequestById(c.get("db"), id);
	if (!authRequest || authRequest.user_id !== c.get("user").id) {
		return errorResponse("Not found", 404);
	}
	c.set("authRequest", authRequest);
	await next();
});

export const requireCipher = createMiddleware<HonoEnv>(async (c, next) => {
	const id = c.req.param("id");
	if (!id) return errorResponse("Not found", 404);
	const cipher = await ciphersDb.getCipherById(
		c.get("db"),
		id,
		c.get("user").id,
	);
	if (!cipher) {
		return errorResponse("Not found", 404);
	}
	if (cipher.user_id !== c.get("user").id) {
		if (!cipher.org_id) return errorResponse("Not found", 404);
		const member = await c
			.get("db")
			.selectFrom("org_members")
			.selectAll()
			.where("org_id", "=", cipher.org_id)
			.where("user_id", "=", c.get("user").id)
			.where("status", "=", "confirmed")
			.executeTakeFirst();
		if (!member) return errorResponse("Not found", 404);
		if (!member.access_all) {
			const visible = await c
				.get("db")
				.selectFrom("cipher_collections as link")
				.innerJoin(
					"collection_members as access",
					"access.collection_id",
					"link.collection_id",
				)
				.select("link.cipher_id")
				.where("link.cipher_id", "=", cipher.id)
				.where("access.org_member_id", "=", member.id)
				.executeTakeFirst();
			if (!visible) return errorResponse("Not found", 404);
		}
		c.set("orgMember", member);
	}
	c.set("cipher", cipher);
	await next();
});

export const requireCipherWrite = createMiddleware<HonoEnv>(async (c, next) => {
	const cipher = c.get("cipher");
	if (cipher.user_id === c.get("user").id) {
		await next();
		return;
	}
	const member = c.get("orgMember");
	if (
		(ROLE_LEVEL[member.role] ?? -1) >= ROLE_LEVEL.manager ||
		member.access_all
	) {
		await next();
		return;
	}
	const links = await c
		.get("db")
		.selectFrom("cipher_collections")
		.select("collection_id")
		.where("cipher_id", "=", cipher.id)
		.execute();
	if (!links.length) return errorResponse("Forbidden", 403);
	const writable = await c
		.get("db")
		.selectFrom("collection_members")
		.select("collection_id")
		.where("org_member_id", "=", member.id)
		.where(
			textColumnInJson(
				"collection_id",
				links.map((link) => link.collection_id),
			),
		)
		.where("read_only", "=", 0)
		.execute();
	if (writable.length !== links.length) return errorResponse("Forbidden", 403);
	await next();
});

export const requireSend = createMiddleware<HonoEnv>(async (c, next) => {
	const id = c.req.param("id");
	if (!id) return errorResponse("Send not found", 404);
	const send = await sendsDb.getSendById(c.get("db"), id);
	if (!send || send.user_id !== c.get("user").id) {
		return errorResponse("Send not found", 404);
	}
	c.set("send", send);
	await next();
});

export const requireSendFile = createMiddleware<HonoEnv>(async (c, next) => {
	const fileId = c.req.param("fileId");
	if (!fileId) return errorResponse("Send file not found", 404);
	const metadata = parseStoredSendFileMetadata(c.get("send").data);
	if (!metadata) return errorResponse("Invalid Send file data", 500);
	const storedFileId = metadata.fileId;
	if (storedFileId !== fileId) {
		return errorResponse("Send file does not match send data.", 400);
	}
	c.set("sendFileId", fileId);
	await next();
});

export const requireAccountPasskey = createMiddleware<HonoEnv>(
	async (c, next) => {
		const id = c.req.param("id");
		if (!id) return errorResponse("Passkey not found", 404);
		const credential = await webauthnDb.getAccountPasskeyCredentialById(
			c.get("db"),
			c.get("user").id,
			id,
		);
		if (!credential) return errorResponse("Passkey not found", 404);
		c.set("accountPasskey", credential);
		await next();
	},
);

const ROLE_LEVEL: Record<string, number> = {
	member: 0,
	manager: 1,
	admin: 2,
	owner: 3,
};

export const requireOrgMember = createMiddleware<HonoEnv>(async (c, next) => {
	const orgId = c.req.param("orgId") || c.req.param("id");
	if (!orgId) return errorResponse("Organization not found", 404);
	const member = await c
		.get("db")
		.selectFrom("org_members as member")
		.innerJoin("organizations as org", "org.id", "member.org_id")
		.selectAll("member")
		.where("member.org_id", "=", orgId)
		.where("member.user_id", "=", c.get("user").id)
		.where("member.status", "=", "confirmed")
		.where("org.deletion_requested_at", "is", null)
		.executeTakeFirst();
	if (!member) return errorResponse("Organization not found", 404);
	c.set("orgMember", member);
	await next();
});

export const requireOrgManager = createMiddleware<HonoEnv>(async (c, next) => {
	const member = c.get("orgMember");
	if ((ROLE_LEVEL[member.role] ?? -1) < ROLE_LEVEL.manager)
		return errorResponse("Forbidden", 403);
	await next();
});

export const requireOrgOwner = createMiddleware<HonoEnv>(async (c, next) => {
	if (c.get("orgMember").role !== "owner")
		return errorResponse("Forbidden", 403);
	await next();
});

export const requireCollection = createMiddleware<HonoEnv>(async (c, next) => {
	const collectionId = c.req.param("collectionId");
	if (!collectionId) return errorResponse("Collection not found", 404);
	const collection = await c
		.get("db")
		.selectFrom("collections")
		.selectAll()
		.where("id", "=", collectionId)
		.where("org_id", "=", c.get("orgMember").org_id)
		.executeTakeFirst();
	if (!collection) return errorResponse("Collection not found", 404);
	c.set("collection", collection);
	await next();
});
