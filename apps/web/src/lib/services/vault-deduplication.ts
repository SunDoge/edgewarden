import { CipherType } from "@edgewarden/shared";
import { match } from "ts-pattern";

type VaultRecord = Record<string, unknown>;

function record(value: unknown): VaultRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as VaultRecord)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function records(value: unknown): VaultRecord[] {
	return Array.isArray(value)
		? value.map(record).filter((entry): entry is VaultRecord => entry !== null)
		: [];
}

function canonicalize(value: unknown): unknown {
	if (value == null || value === "") return undefined;
	if (Array.isArray(value)) {
		const entries = value
			.map(canonicalize)
			.filter((entry) => entry !== undefined);
		return entries.length ? entries : undefined;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as VaultRecord)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, canonicalize(entry)] as const)
			.filter(([, entry]) => entry !== undefined);
		return entries.length ? Object.fromEntries(entries) : undefined;
	}
	return value;
}

function projectLogin(value: unknown): unknown {
	const login = record(value);
	if (!login) return null;
	const uriRecords = records(login.uris);
	const uris = uriRecords.length
		? uriRecords
		: text(login.uri)
			? [{ uri: login.uri }]
			: [];
	return {
		username: text(login.username),
		password: text(login.password),
		totp: text(login.totp),
		uris: uris.map((uri) => ({
			uri: text(uri.uri),
			match: typeof uri.match === "number" ? uri.match : null,
		})),
		fido2Credentials: records(login.fido2Credentials).map((credential) => ({
			credentialId: text(credential.credentialId),
			keyType: text(credential.keyType),
			keyAlgorithm: text(credential.keyAlgorithm),
			keyCurve: text(credential.keyCurve),
			keyValue: text(credential.keyValue),
			rpId: text(credential.rpId),
			rpName: text(credential.rpName),
			userHandle: text(credential.userHandle),
			userName: text(credential.userName),
			userDisplayName: text(credential.userDisplayName),
			counter:
				typeof credential.counter === "number" ? credential.counter : null,
			discoverable:
				typeof credential.discoverable === "boolean"
					? credential.discoverable
					: null,
			creationDate: text(credential.creationDate),
		})),
	};
}

function projectCard(value: unknown): unknown {
	const card = record(value);
	return card
		? {
				cardholderName: text(card.cardholderName),
				brand: text(card.brand),
				number: text(card.number),
				expMonth: text(card.expMonth),
				expYear: text(card.expYear),
				code: text(card.code),
			}
		: null;
}

const IDENTITY_FIELDS = [
	"title",
	"firstName",
	"middleName",
	"lastName",
	"address1",
	"address2",
	"address3",
	"city",
	"state",
	"postalCode",
	"country",
	"company",
	"email",
	"phone",
	"ssn",
	"username",
	"passportNumber",
	"licenseNumber",
] as const;

const BANK_ACCOUNT_FIELDS = [
	"bankName",
	"nameOnAccount",
	"accountType",
	"accountNumber",
	"routingNumber",
	"branchNumber",
	"pin",
	"swiftCode",
	"iban",
	"bankContactPhone",
] as const;

const DRIVERS_LICENSE_FIELDS = [
	"firstName",
	"middleName",
	"lastName",
	"dateOfBirth",
	"licenseNumber",
	"issuingCountry",
	"issuingState",
	"issueDate",
	"expirationDate",
	"issuingAuthority",
	"licenseClass",
] as const;

const PASSPORT_FIELDS = [
	"surname",
	"givenName",
	"dateOfBirth",
	"sex",
	"birthPlace",
	"nationality",
	"issuingCountry",
	"passportNumber",
	"passportType",
	"nationalIdentificationNumber",
	"issuingAuthority",
	"issueDate",
	"expirationDate",
] as const;

function projectTextFields(value: unknown, fields: readonly string[]): unknown {
	const source = record(value);
	return source
		? Object.fromEntries(fields.map((field) => [field, text(source[field])]))
		: null;
}

function projectTypeData(item: VaultRecord, type: number): unknown {
	const secureNote = record(item.secureNote);
	const sshKey = record(item.sshKey);
	return match(type)
		.with(CipherType.Login, () => projectLogin(item.login))
		.with(CipherType.SecureNote, () => ({
			type: typeof secureNote?.type === "number" ? secureNote.type : 0,
		}))
		.with(CipherType.Card, () => projectCard(item.card))
		.with(CipherType.Identity, () =>
			projectTextFields(item.identity, IDENTITY_FIELDS),
		)
		.with(CipherType.SshKey, () =>
			sshKey
				? {
						privateKey: text(sshKey.privateKey),
						publicKey: text(sshKey.publicKey),
						fingerprint: text(sshKey.fingerprint || sshKey.keyFingerprint),
					}
				: null,
		)
		.with(CipherType.BankAccount, () =>
			projectTextFields(item.bankAccount, BANK_ACCOUNT_FIELDS),
		)
		.with(CipherType.DriversLicense, () =>
			projectTextFields(item.driversLicense, DRIVERS_LICENSE_FIELDS),
		)
		.with(CipherType.Passport, () =>
			projectTextFields(item.passport, PASSPORT_FIELDS),
		)
		.otherwise(() => null);
}

function projectFields(value: unknown): unknown[] {
	return records(value).map((field) => ({
		type: typeof field.type === "number" ? field.type : null,
		name: text(field.name),
		value: text(field.value),
		linkedId: typeof field.linkedId === "number" ? field.linkedId : null,
	}));
}

function projectPasswordHistory(value: unknown): unknown[] {
	return records(value).map((entry) => ({
		password: text(entry.password),
		lastUsedDate: text(entry.lastUsedDate),
	}));
}

function projectAttachments(value: unknown): unknown[] {
	return records(value).map((attachment) => ({
		fileName: text(attachment.fileName),
		size: typeof attachment.size === "number" ? attachment.size : null,
	}));
}

/**
 * Creates a schema-driven signature from decrypted, user-visible cipher data.
 * IDs, timestamps, ciphertext keys, checksums and unknown server metadata are
 * deliberately excluded so a sync round trip does not change the signature.
 */
export function cipherContentFingerprint(
	item: VaultRecord,
	folderName?: string | null,
): string {
	const type = Number(item.type) || CipherType.Login;
	return JSON.stringify(
		canonicalize({
			folder: folderName || undefined,
			organizationId: item.organizationId ?? null,
			collectionIds: Array.isArray(item.collectionIds)
				? [...item.collectionIds].map(String).sort()
				: null,
			type,
			name: text(item.name).trim(),
			notes: text(item.notes).trim(),
			favorite: Boolean(item.favorite),
			reprompt: Number(item.reprompt) === 1 ? 1 : 0,
			fields: projectFields(item.fields),
			passwordHistory: projectPasswordHistory(item.passwordHistory),
			attachments: projectAttachments(item.attachments),
			data: projectTypeData(item, type),
		}),
	);
}
