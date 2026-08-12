import { type Selectable, sql } from "kysely";
import { factory } from "../http/factory";
import { cipherToResponse } from "../services/ciphers/presentation";
import * as attachmentsDb from "../services/db/attachments";
import * as ciphersDb from "../services/db/ciphers";
import * as domainSettingsDb from "../services/db/domain-settings";
import * as foldersDb from "../services/db/folders";
import { textColumnInJson } from "../services/db/json-array";
import * as sendsDb from "../services/db/sends";
import * as webauthnDb from "../services/db/webauthn";
import {
	buildDomainsResponse,
	normalizeCustomEquivalentDomains,
} from "../services/domain-rules";
import { sendToResponse } from "../services/sends/presentation";
import type { Folders } from "../types/db";
import { buildWebAuthnPrfOption } from "../utils/account-passkeys";
import { now, toIso } from "../utils/time";
import { buildUserDecryptionOptions } from "../utils/user-decryption";
import { userYubicoPublicIds } from "../utils/yubico";

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
	const personalCiphers = await ciphersDb.getAllCiphersByUserId(db, user.id);
	const folders = await foldersDb.getFoldersByUserId(db, user.id);
	const domainSettings = await domainSettingsDb.getDomainSettings(db, user.id);
	const accountCredentials =
		await webauthnDb.listAllAccountPasskeyCredentialsByUserId(db, user.id);
	const accountPasskeys = accountCredentials.filter(
		(credential) => credential.purpose === "login",
	);
	const hasTwoFactorPasskey = accountCredentials.some(
		(credential) => credential.purpose === "twoFactor",
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
		.where("org.deletion_requested_at", "is", null)
		.execute();
	const organizationIds = organizationRows.map((row) => row.org_id);
	const allAccessOrgIds = organizationRows
		.filter((row) => row.access_all === 1)
		.map((row) => row.org_id);
	const restrictedMembers = organizationRows.filter(
		(row) => row.access_all !== 1,
	);
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
	const visibleCollections = organizationIds.length
		? await db
				.selectFrom("collections")
				.selectAll()
				.where((expression) =>
					expression.or([
						sql<boolean>`org_id in (
							select value from json_each(${JSON.stringify(allAccessOrgIds)})
						)`,
						textColumnInJson("id", allowedRestrictedCollectionIds),
					]),
				)
				.execute()
		: [];
	const organizationCiphers = organizationIds.length
		? await db
				.selectFrom("ciphers")
				.selectAll()
				.where((expression) =>
					expression.or([
						sql<boolean>`org_id in (
							select value from json_each(${JSON.stringify(allAccessOrgIds)})
						)`,
						sql<boolean>`id in (
							select cipher_id
							from cipher_collections
							where collection_id in (
								select value from json_each(${JSON.stringify(allowedRestrictedCollectionIds)})
							)
						)`,
					]),
				)
				.where((expression) =>
					expression.or([
						expression("purge_after", "is", null),
						expression("purge_after", ">", now()),
					]),
				)
				.execute()
		: [];

	const webAuthnPrfOptions = accountPasskeys
		.map(buildWebAuthnPrfOption)
		.filter((option): option is NonNullable<typeof option> => !!option);
	const firstPrfOption = webAuthnPrfOptions[0] || null;
	const userDecryptionOptions = buildUserDecryptionOptions(
		user,
		firstPrfOption,
	);

	const allCiphers = [...personalCiphers, ...organizationCiphers];
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
		.selectFrom("cipher_collections")
		.selectAll()
		.where((expression) =>
			expression.or([
				sql<boolean>`cipher_id in (
					select id from ciphers where user_id = ${user.id}
					union
					select id from ciphers where org_id in (
						select value from json_each(${JSON.stringify(allAccessOrgIds)})
					)
				)`,
				textColumnInJson("collection_id", allowedRestrictedCollectionIds),
			]),
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
			hasTwoFactorPasskey ||
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
				"cipher",
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
