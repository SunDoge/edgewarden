import { CipherType } from "@edgewarden/shared";

const TYPE_KEYS: Record<number, string> = {
	[CipherType.Login]: "login",
	[CipherType.SecureNote]: "secureNote",
	[CipherType.Card]: "card",
	[CipherType.Identity]: "identity",
	[CipherType.SshKey]: "sshKey",
	[CipherType.BankAccount]: "bankAccount",
	[CipherType.DriversLicense]: "driversLicense",
	[CipherType.Passport]: "passport",
};

function canonicalize(value: unknown): unknown {
	if (value == null || value === "") return undefined;
	if (Array.isArray(value)) {
		const entries = value
			.map(canonicalize)
			.filter((entry) => entry !== undefined);
		return entries.length ? entries : undefined;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, canonicalize(entry)] as const)
			.filter(([, entry]) => entry !== undefined);
		return entries.length ? Object.fromEntries(entries) : undefined;
	}
	return value;
}

/**
 * Produces a stable fingerprint for decrypted cipher content. Empty values are
 * collapsed because Bitwarden exports, encryption and sync responses represent
 * the same default in several different ways during a round trip.
 */
export function cipherContentFingerprint(
	item: Record<string, any>,
	folderName?: string | null,
): string {
	const type = Number(item.type) || CipherType.Login;
	const typeKey = TYPE_KEYS[type];
	return JSON.stringify(
		canonicalize({
			folder: folderName || undefined,
			organizationId: item.organizationId ?? null,
			collectionIds: item.collectionIds ?? null,
			type,
			name: String(item.name ?? "").trim(),
			notes:
				typeof item.notes === "string"
					? item.notes.trim()
					: (item.notes ?? null),
			favorite: Boolean(item.favorite),
			reprompt: Number(item.reprompt) === 1 ? 1 : 0,
			fields: item.fields ?? null,
			passwordHistory: item.passwordHistory ?? null,
			attachments: item.attachments ?? null,
			data: typeKey ? (item[typeKey] ?? null) : null,
		}),
	);
}
