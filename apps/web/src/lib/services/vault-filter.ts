import { CipherType, type CipherResponse } from "@edgewarden/shared";
import { match } from "ts-pattern";

export type VaultCategory =
	| "all"
	| "favorites"
	| "login"
	| "securenote"
	| "card"
	| "identity"
	| "trash"
	| "archive"
	| "duplicates";
export type VaultSort = "name" | "edited" | "created";
export type DuplicateMode =
	| "exact"
	| "login-site"
	| "login-credentials"
	| "password";

export interface VaultFilterOptions {
	category: VaultCategory;
	folderId: string | null;
	query: string;
	sort: VaultSort;
	duplicateMode?: DuplicateMode;
}

function loginHost(item: CipherResponse): string {
	const login = item.login as any;
	const raw = login?.uris?.[0]?.uri ?? login?.uri ?? "";
	if (!raw) return "";
	try {
		return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
			.toLowerCase()
			.replace(/^www\./, "");
	} catch {
		return String(raw).toLowerCase();
	}
}

export function findDuplicateCipherIds(
	items: CipherResponse[],
	mode: DuplicateMode,
): Set<string> {
	const groups = new Map<string, string[]>();
	for (const item of items) {
		if (isDeletedCipher(item) || item.archivedDate) continue;
		const login = item.login as any;
		const key = match(mode)
			.with("exact", () =>
				JSON.stringify([
					item.type,
					item.name.toLocaleLowerCase(),
					item.notes,
					item.login,
					item.card,
					item.identity,
					item.sshKey,
				]),
			)
			.with("login-site", () =>
				item.type === CipherType.Login ? loginHost(item) : "",
			)
			.with("login-credentials", () =>
				item.type === CipherType.Login
					? `${loginHost(item)}\n${String(login?.username ?? "").toLocaleLowerCase()}`
					: "",
			)
			.with("password", () =>
				item.type === CipherType.Login ? String(login?.password ?? "") : "",
			)
			.exhaustive();
		if (!key) continue;
		groups.set(key, [...(groups.get(key) ?? []), item.id]);
	}
	return new Set(
		Array.from(groups.values())
			.filter((ids) => ids.length > 1)
			.flat(),
	);
}

function searchableText(item: CipherResponse): string {
	const login = item.login as Record<string, unknown> | null;
	return [item.name, item.notes, login?.username, login?.uri]
		.map((value) => String(value ?? "").toLocaleLowerCase())
		.join("\n");
}

export function isDeletedCipher(item: CipherResponse): boolean {
	return Boolean(item.deletedDate);
}

export function filterAndSortVaultItems(
	items: CipherResponse[],
	options: VaultFilterOptions,
): CipherResponse[] {
	const query = options.query.trim().toLocaleLowerCase();
	const duplicateIds =
		options.category === "duplicates"
			? findDuplicateCipherIds(items, options.duplicateMode ?? "exact")
			: null;
	return items
		.filter((item) => {
			const deleted = isDeletedCipher(item);
			if (options.category === "trash")
				return deleted && (!query || searchableText(item).includes(query));
			if (deleted) return false;
			if (options.category === "archive")
				return (
					Boolean(item.archivedDate) &&
					(!query || searchableText(item).includes(query))
				);
			if (item.archivedDate) return false;
			if (options.category === "duplicates")
				return (
					!!duplicateIds?.has(item.id) &&
					(!query || searchableText(item).includes(query))
				);
			const categoryMatch = match(options.category)
				.with("all", () => true)
				.with("favorites", () => item.favorite)
				.with("login", () => item.type === CipherType.Login)
				.with("securenote", () => item.type === CipherType.SecureNote)
				.with("card", () => item.type === CipherType.Card)
				.with("identity", () => item.type === CipherType.Identity)
				.exhaustive();
			return (
				categoryMatch &&
				(!options.folderId || item.folderId === options.folderId) &&
				(!query || searchableText(item).includes(query))
			);
		})
		.sort((a, b) =>
			match(options.sort)
				.with("name", () =>
					a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
				)
				.with(
					"created",
					() => Date.parse(b.creationDate) - Date.parse(a.creationDate),
				)
				.with(
					"edited",
					() => Date.parse(b.revisionDate) - Date.parse(a.revisionDate),
				)
				.exhaustive(),
		);
}
