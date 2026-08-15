import { vValidator } from "@hono/valibot-validator";
import { type CompiledQuery, sql } from "kysely";
import { LIMITS } from "../../config";
import { factory } from "../../http/factory";
import { CipherSchema } from "../../schemas/ciphers";
import { auditEventInsertQuery, auditRequestMetadata } from "../../services/audit";
import {
	conditionalCipherRevisionQuery,
	getCipherCollectionIds,
	getCipherPermissions,
	organizationCipherViewStateQuery,
	revisionQueriesForCipher,
	validateOrganizationCollections,
} from "../../services/ciphers/access";
import {
	buildCipherData,
	cipherToResponse,
} from "../../services/ciphers/presentation";
import * as attachmentsDb from "../../services/db/attachments";
import { executeBatch } from "../../services/db/batch";
import * as ciphersDb from "../../services/db/ciphers";
import * as foldersDb from "../../services/db/folders";
import { errorResponse } from "../../utils/response";
import { now } from "../../utils/time";

// List responses batch attachment reads to avoid one D1 query per cipher.
// GET /api/ciphers
export const listCiphers = factory.createHandlers(async (c) => {
	const user = c.get("user");
	const db = c.get("db");
	const ciphers = await ciphersDb.getCiphersByUserId(db, user.id);
	const attachments = await attachmentsDb.listByCipherIds(
		db,
		ciphers.map((cipher) => cipher.id),
	);
	const attachmentsByCipher = Map.groupBy(
		attachments,
		(attachment) => attachment.cipher_id,
	);
	return c.json({
		data: ciphers.map((cipher) =>
			cipherToResponse(cipher, attachmentsByCipher.get(cipher.id)),
		),
		object: "list",
		continuationToken: null,
	});
});
