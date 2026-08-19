export interface SortableRemoteItem {
  name: string;
  isDirectory: boolean;
}

export function isBackupArchiveName(name: string): boolean {
  return /\.zip$/i.test(String(name || "").trim());
}

export function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function trimSlashes(value: string): string {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

export function buildJoinedPath(...segments: string[]): string {
  return segments.map(trimSlashes).filter(Boolean).join("/");
}

export function normalizeRelativePath(path: string): string {
  const normalized = trimSlashes(path).replace(/\\/g, "/");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid remote backup path");
  }
  return parts.join("/");
}

export function basename(path: string): string {
  return trimSlashes(path).split("/").filter(Boolean).at(-1) || "";
}

export function parentPath(path: string): string | null {
  const normalized = normalizeRelativePath(path);
  if (!normalized) return null;
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/");
}

export function sortRemoteItems<T extends SortableRemoteItem>(items: T[]): T[] {
  return items.slice().sort((a, b) => {
    const aIsAttachments = a.isDirectory && a.name === "attachments";
    const bIsAttachments = b.isDirectory && b.name === "attachments";
    if (aIsAttachments !== bIsAttachments) return aIsAttachments ? -1 : 1;
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, "en");
  });
}

function decodeXmlText(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (match, entity) => {
    const decoded: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      "#39": "'",
    };
    return decoded[entity] ?? match;
  });
}

export function parseHttpDate(value: string): string | null {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function extractXmlBlocks(xml: string, tagName: string): string[] {
  const pattern = new RegExp(
    `<(?:[^:>]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)</(?:[^:>]+:)?${tagName}>`,
    "gi",
  );
  return Array.from(xml.matchAll(pattern), (match) => match[1]);
}

export function extractXmlFirst(xml: string, tagName: string): string | null {
  const pattern = new RegExp(
    `<(?:[^:>]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)</(?:[^:>]+:)?${tagName}>`,
    "i",
  );
  const match = xml.match(pattern);
  return match?.[1] ? decodeXmlText(match[1].trim()) : null;
}
