import type { Selectable } from "kysely";
import type { Attachments, Ciphers } from "../../types/db";
import { toIso } from "../../utils/time";

export type CipherPermissions = { edit: boolean; viewPassword: boolean };

export interface CipherBody {
	[key: string]: unknown;
	login?: Record<string, unknown> | null;
	secureNote?: Record<string, unknown> | null;
	card?: Record<string, unknown> | null;
	identity?: Record<string, unknown> | null;
	sshKey?: Record<string, unknown> | null;
	bankAccount?: Record<string, unknown> | null;
	driversLicense?: Record<string, unknown> | null;
	passport?: Record<string, unknown> | null;
	fields?: unknown[] | null;
	passwordHistory?: unknown[] | null;
}

const SERVER_MANAGED_CIPHER_FIELDS = new Set([
	"id",
	"organizationId",
	"folderId",
	"type",
	"name",
	"notes",
	"collectionIds",
	"favorite",
	"reprompt",
	"key",
	"fields",
	"passwordHistory",
	"attachments",
	"revisionDate",
	"creationDate",
	"deletedDate",
	"archivedDate",
	"object",
	"edit",
	"viewPassword",
	"permissions",
	"organizationUseTotp",
	"lastKnownRevisionDate",
]);

export function buildCipherData(body: CipherBody): string {
	const data: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(body)) {
		if (!SERVER_MANAGED_CIPHER_FIELDS.has(key) && value !== undefined) {
			data[key] = value;
		}
	}
	return JSON.stringify(data);
}

export function cipherToResponse(
	cipher: Selectable<Ciphers>,
	attachments: Selectable<Attachments>[] = [],
	collectionIds: string[] = [],
	permissions: CipherPermissions = { edit: true, viewPassword: true },
	object: "cipher" | "cipherDetails" = "cipherDetails",
) {
	const data = JSON.parse(cipher.data) as Record<string, unknown>;
	return {
		...data,
		id: cipher.id,
		organizationId: cipher.org_id ?? null,
		folderId: cipher.folder_id ?? null,
		type: cipher.type,
		name: cipher.name,
		notes: cipher.notes ?? null,
		fields: cipher.fields ? JSON.parse(cipher.fields) : (data.fields ?? null),
		data: null,
		login: cipher.type === 1 ? (data.login ?? null) : null,
		secureNote: cipher.type === 2 ? (data.secureNote ?? null) : null,
		card: cipher.type === 3 ? (data.card ?? null) : null,
		identity: cipher.type === 4 ? (data.identity ?? null) : null,
		sshKey: cipher.type === 5 ? (data.sshKey ?? null) : null,
		bankAccount: cipher.type === 6 ? (data.bankAccount ?? null) : null,
		driversLicense: cipher.type === 7 ? (data.driversLicense ?? null) : null,
		passport: cipher.type === 8 ? (data.passport ?? null) : null,
		favorite: cipher.favorite === 1,
		reprompt: cipher.reprompt ?? 0,
		key: cipher.key ?? null,
		attachments: attachments.map((attachment) => ({
			id: attachment.id,
			fileName: attachment.file_name,
			size: attachment.size,
			sizeName: attachment.size_name,
			key: attachment.key,
			object: "attachment",
		})),
		organizationUseTotp: false,
		edit: permissions.edit,
		viewPassword: permissions.viewPassword,
		permissions: { delete: permissions.edit, restore: permissions.edit },
		collectionIds,
		revisionDate: toIso(cipher.updated_at),
		creationDate: toIso(cipher.created_at),
		deletedDate: cipher.deleted_at ? toIso(cipher.deleted_at) : null,
		archivedDate: cipher.archived_at ? toIso(cipher.archived_at) : null,
		passwordHistory: cipher.password_history
			? JSON.parse(cipher.password_history)
			: (data.passwordHistory ?? null),
		object,
	};
}
