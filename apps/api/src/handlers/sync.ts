import { sql, type Selectable } from "kysely";
import { factory } from "../http/factory";
import * as ciphersDb from "../services/db/ciphers";
import * as attachmentsDb from "../services/db/attachments";
import * as domainSettingsDb from "../services/db/domain-settings";
import * as foldersDb from "../services/db/folders";
import * as sendsDb from "../services/db/sends";
import * as webauthnDb from "../services/db/webauthn";
import {
	buildDomainsResponse,
	normalizeCustomEquivalentDomains,
} from "../services/domain-rules";
import type { Attachments, Ciphers, Folders, Sends } from "../types/db";
import { buildWebAuthnPrfOption } from "../utils/account-passkeys";
import { toIso } from "../utils/time";
import { buildUserDecryptionOptions } from "../utils/user-decryption";
import { userYubicoPublicIds } from "../utils/yubico";

function cipherToResponse(
	cipher: Selectable<Ciphers>,
	attachments: Selectable<Attachments>[] = [],
	collectionIds: string[] = [],
	permissions = { edit: true, viewPassword: true },
) {
	const data = JSON.parse(cipher.data) as Record<string, unknown>;
	return {
		id: cipher.id,
		organizationId: cipher.org_id ?? null,
		folderId: cipher.folder_id ?? null,
		type: cipher.type,
		name: cipher.name,
		notes: cipher.notes ?? null,
		fields: cipher.fields ? JSON.parse(cipher.fields) : null,
		data: null, // unused in modern clients; type-specific fields below
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
		permissions: {
			delete: permissions.edit,
			restore: permissions.edit,
		},
		collectionIds,
		revisionDate: toIso(cipher.updated_at),
		creationDate: toIso(cipher.created_at),
		deletedDate: cipher.deleted_at ? toIso(cipher.deleted_at) : null,
		archivedDate: cipher.archived_at ? toIso(cipher.archived_at) : null,
		passwordHistory: cipher.password_history
			? JSON.parse(cipher.password_history)
			: null,
		object: "cipherDetails",
	};
}

function sendToResponse(send: Selectable<Sends>) {
	return {
		id: send.id,
		type: send.type,
		name: send.name,
		notes: send.notes,
		text: send.type === 0 ? JSON.parse(send.data) : null,
		file: send.type === 1 ? JSON.parse(send.data) : null,
		key: send.key,
		maxAccessCount: send.max_access_count,
		accessCount: send.access_count,
		password: send.password_hash ? "true" : null,
		authType: send.auth_type,
		disabled: send.disabled === 1,
		hideEmail: send.hide_email === 1,
		revisionDate: toIso(send.updated_at),
		expirationDate: send.expiration_date ? toIso(send.expiration_date) : null,
		deletionDate: toIso(send.deletion_date),
		object: "send",
	};
}

function folderToResponse(folder: Selectable<Folders>) {
	return {
		id: folder.id,
		name: folder.name,
		revisionDate: toIso(folder.updated_at),
		object: "folder",
	};
}

// GET /api/sync
export const sync = factory.createHandlers(async (c) => {
	const user = c.get("user");
	const db = c.get("db");

	// Keep queries on the Kysely-D1 connection ordered. Promise.all does not make
	// a single D1 session faster and can make adapters overlap session requests.
	const ciphers = await ciphersDb.getCiphersByUserId(db, user.id);
	const deletedCiphers = await ciphersDb.getDeletedCiphersByUserId(db, user.id);
	const folders = await foldersDb.getFoldersByUserId(db, user.id);
	const domainSettings = await domainSettingsDb.getDomainSettings(db, user.id);
	const accountPasskeys =
		await webauthnDb.listAccountPasskeyCredentialsByUserId(db, user.id);
	const twoFactorPasskeyCount =
		await webauthnDb.countAccountPasskeyCredentialsByUserId(
			db,
			user.id,
			"twoFactor",
		);
	const sends = await sendsDb.getSendsByUserId(db, user.id);
	const organizationRows = await db
		.selectFrom("org_members as member")
		.innerJoin("organizations as org", "org.id", "member.org_id")
		.select([
			"member.id as member_id",
			"member.org_id",
			"member.key",
			"member.role",
			"member.status",
			"member.access_all",
			"org.name",
			"org.public_key",
			"org.private_key",
			"org.created_at",
			"org.updated_at",
		])
		.where("member.user_id", "=", user.id)
		.where("member.status", "=", "confirmed")
		.execute();
	const organizationIds = organizationRows.map((row) => row.org_id);
	const allAccessOrgIds = organizationRows
		.filter((row) => row.access_all === 1)
		.map((row) => row.org_id);
	const restrictedMembers = organizationRows.filter(
		(row) => row.access_all !== 1,
	);
	const organizationCollections = organizationIds.length
		? await db
				.selectFrom("collections")
				.selectAll()
				.where(
					sql<boolean>`org_id in (select value from json_each(${JSON.stringify(organizationIds)}))`,
				)
				.execute()
		: [];
	const restrictedCollectionAccess = restrictedMembers.length
		? await db
				.selectFrom("collection_members")
				.select(["collection_id", "read_only", "hide_passwords"])
				.where(
					sql<boolean>`org_member_id in (select value from json_each(${JSON.stringify(restrictedMembers.map((row) => row.member_id))}))`,
				)
				.execute()
		: [];
	const allowedRestrictedCollectionIds = restrictedCollectionAccess.map(
		(row) => row.collection_id,
	);
	const restrictedAccessByCollection = new Map(
		restrictedCollectionAccess.map((row) => [row.collection_id, row]),
	);
	const visibleCollections = organizationCollections.filter(
		(collection) =>
			allAccessOrgIds.includes(collection.org_id) ||
			allowedRestrictedCollectionIds.includes(collection.id),
	);
	const allAccessCiphers = allAccessOrgIds.length
		? await db
				.selectFrom("ciphers")
				.selectAll()
				.where(
					sql<boolean>`org_id in (select value from json_each(${JSON.stringify(allAccessOrgIds)}))`,
				)
				.execute()
		: [];
	const restrictedCiphers = allowedRestrictedCollectionIds.length
		? await db
				.selectFrom("ciphers as cipher")
				.innerJoin("cipher_collections as link", "link.cipher_id", "cipher.id")
				.selectAll("cipher")
				.where(
					sql<boolean>`link.collection_id in (select value from json_each(${JSON.stringify(allowedRestrictedCollectionIds)}))`,
				)
				.execute()
		: [];
	const orgCipherMap = new Map(
		[...allAccessCiphers, ...restrictedCiphers].map((cipher) => [
			cipher.id,
			cipher,
		]),
	);
	const organizationCiphers = [...orgCipherMap.values()];

	const webAuthnPrfOptions = accountPasskeys
		.map(buildWebAuthnPrfOption)
		.filter((option): option is NonNullable<typeof option> => !!option);
	const firstPrfOption = webAuthnPrfOptions[0] || null;
	const userDecryptionOptions = buildUserDecryptionOptions(
		user,
		firstPrfOption,
	);

	const allCiphers = [...ciphers, ...deletedCiphers, ...organizationCiphers];
	const attachments = await attachmentsDb.listVisibleForSync(
		db,
		user.id,
		allAccessOrgIds,
		allowedRestrictedCollectionIds,
	);
	const attachmentsByCipher = Map.groupBy(
		attachments,
		(attachment) => attachment.cipher_id,
	);
	const cipherCollectionLinks = await db
		.selectFrom("cipher_collections as link")
		.innerJoin("ciphers as cipher", "cipher.id", "link.cipher_id")
		.selectAll("link")
		.where(
			sql<boolean>`
				cipher.user_id = ${user.id}
				or cipher.org_id in (
					select value from json_each(${JSON.stringify(allAccessOrgIds)})
				)
				or link.collection_id in (
					select value from json_each(${JSON.stringify(allowedRestrictedCollectionIds)})
				)
			`,
		)
		.execute();
	const collectionIdsByCipher = Map.groupBy(
		cipherCollectionLinks,
		(link) => link.cipher_id,
	);

	const profile = {
		id: user.id,
		name: user.name,
		email: user.email,
		emailVerified: true,
		premium: true,
		premiumFromOrganization: false,
		masterPasswordHint: user.master_password_hint,
		culture: "en-US",
		twoFactorEnabled:
			!!user.totp_secret ||
			twoFactorPasskeyCount > 0 ||
			userYubicoPublicIds(user as any).length > 0,
		key: user.key,
		privateKey: user.private_key,
		publicKey: user.public_key,
		securityStamp: user.security_stamp,
		forcePasswordReset: false,
		usesKeyConnector: false,
		avatarColor: null,
		kdf: user.kdf_type,
		kdfIterations: user.kdf_iterations,
		kdfMemory: user.kdf_memory ?? null,
		kdfParallelism: user.kdf_parallelism ?? null,
		role: user.role,
		organizations: organizationRows.map((row) => ({
			id: row.org_id,
			name: row.name,
			key: row.key,
			publicKey: row.public_key,
			privateKey: row.private_key,
			role: row.role,
			status: row.status,
			accessAll: Boolean(row.access_all),
			creationDate: toIso(row.created_at),
			revisionDate: toIso(row.updated_at),
			object: "profileOrganization",
		})),
		providers: [],
		providerOrganizations: [],
		object: "profile",
	};

	const equivalentDomains = domainSettings
		? (JSON.parse(domainSettings.equivalent_domains) as string[][])
		: [];
	const customEquivalentDomains = domainSettings
		? normalizeCustomEquivalentDomains(
				JSON.parse(domainSettings.custom_equivalent_domains),
			)
		: [];
	const excludedGlobalEquivalentDomains = domainSettings
		? (JSON.parse(
				domainSettings.excluded_global_equivalent_domains,
			) as number[])
		: [];

	const domains = buildDomainsResponse(
		equivalentDomains,
		customEquivalentDomains,
		excludedGlobalEquivalentDomains,
	);

	return c.json({
		profile,
		folders: folders.map(folderToResponse),
		collections: visibleCollections.map((collection) => {
			const access = restrictedAccessByCollection.get(collection.id);
			return {
				id: collection.id,
				organizationId: collection.org_id,
				name: collection.name,
				readOnly: Boolean(access?.read_only),
				hidePasswords: Boolean(access?.hide_passwords),
				creationDate: toIso(collection.created_at),
				revisionDate: toIso(collection.updated_at),
				object: "collectionDetails",
			};
		}),
		ciphers: allCiphers.map((cipher) => {
			const collectionIds =
				collectionIdsByCipher
					.get(cipher.id)
					?.map((link) => link.collection_id) ?? [];
			const restrictedAccess =
				cipher.org_id && !allAccessOrgIds.includes(cipher.org_id)
					? collectionIds.map((id) => restrictedAccessByCollection.get(id))
					: [];
			return cipherToResponse(
				cipher,
				attachmentsByCipher.get(cipher.id),
				collectionIds,
				{
					edit: !restrictedAccess.some((access) => access?.read_only === 1),
					viewPassword: !restrictedAccess.some(
						(access) => access?.hide_passwords === 1,
					),
				},
			);
		}),
		domains,
		policies: [],

		sends: sends.map(sendToResponse),
		unofficialServer: true,
		UserDecryption: {
			MasterPasswordUnlock: userDecryptionOptions.MasterPasswordUnlock,
			TrustedDeviceOption: null,
			KeyConnectorOption: null,
			WebAuthnPrfOption: firstPrfOption,
			WebAuthnPrfOptions: webAuthnPrfOptions,
			Object: "userDecryption",
		},
		UserDecryptionOptions: userDecryptionOptions,
		userDecryptionOptions,
		object: "sync",
	});
});
