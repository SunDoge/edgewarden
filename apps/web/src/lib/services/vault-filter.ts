import { type CipherResponse, CipherType } from "@edgewarden/shared";
import { match } from "ts-pattern";
import { cipherContentFingerprint } from "./vault-deduplication";
import type { VaultCipher, VaultLoginData } from "./vault-types";

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

function loginHosts(item: CipherResponse): string[] {
  const login = item.login as VaultLoginData | null;
  const rawUris = Array.isArray(login?.uris)
    ? login.uris.map((entry) => entry.uri)
    : [login?.uri];
  const hosts = new Set<string>();
  for (const value of rawUris) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    try {
      hosts.add(
        new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
          .toLowerCase()
          .replace(/^www\./, ""),
      );
    } catch {
      hosts.add(raw.toLowerCase());
    }
  }
  return [...hosts].filter(Boolean).sort();
}

export function findDuplicateCipherGroups(
  items: CipherResponse[],
  mode: DuplicateMode,
): string[][] {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    if (isDeletedCipher(item) || item.archivedDate) continue;
    const login = item.login as VaultLoginData | null;
    const username = String(login?.username ?? "")
      .trim()
      .toLocaleLowerCase();
    const password = String(login?.password ?? "");
    const keys = match(mode)
      .with("exact", () => [
        cipherContentFingerprint(item as unknown as Record<string, unknown>),
      ])
      .with("login-site", () =>
        item.type === CipherType.Login && username && password
          ? loginHosts(item).map((site) =>
              JSON.stringify(["login-site", site, username, password]),
            )
          : [],
      )
      .with("login-credentials", () =>
        item.type === CipherType.Login && username && password
          ? [JSON.stringify(["login-credentials", username, password])]
          : [],
      )
      .with("password", () =>
        item.type === CipherType.Login && password
          ? [JSON.stringify(["password", password])]
          : [],
      )
      .exhaustive();
    for (const key of keys)
      groups.set(key, [...(groups.get(key) ?? []), item.id]);
  }
  const duplicateGroups = Array.from(groups.values()).filter(
    (ids) => ids.length > 1,
  );
  const neighbours = new Map<string, Set<string>>();
  for (const ids of duplicateGroups) {
    for (const id of ids) {
      const adjacent = neighbours.get(id) ?? new Set<string>();
      for (const other of ids) if (other !== id) adjacent.add(other);
      neighbours.set(id, adjacent);
    }
  }
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const id of neighbours.keys()) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    const pending = [id];
    while (pending.length) {
      const current = pending.pop();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      pending.push(...(neighbours.get(current) ?? []));
    }
    components.push(component);
  }
  return components;
}

export function findDuplicateCipherIds(
  items: CipherResponse[],
  mode: DuplicateMode,
): Set<string> {
  return new Set(findDuplicateCipherGroups(items, mode).flat());
}

/** Selects every redundant copy while keeping the most recently edited item. */
export function findRedundantDuplicateCipherIds(
  items: CipherResponse[],
  mode: DuplicateMode,
): Set<string> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const isReadOnly = (id: string) =>
    Boolean((byId.get(id) as VaultCipher | undefined)?.readOnly);
  return new Set(
    findDuplicateCipherGroups(items, mode).flatMap((ids) =>
      ids
        .toSorted((left, right) => {
          const leftDate = Date.parse(byId.get(left)?.revisionDate ?? "") || 0;
          const rightDate =
            Date.parse(byId.get(right)?.revisionDate ?? "") || 0;
          return rightDate - leftDate || left.localeCompare(right);
        })
        .slice(1)
        .filter((id) => !isReadOnly(id)),
    ),
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

export function filterAndSortVaultItems<T extends CipherResponse>(
  items: T[],
  options: VaultFilterOptions,
): T[] {
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
