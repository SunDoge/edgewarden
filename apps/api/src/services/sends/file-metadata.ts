export interface StoredSendFileMetadata {
  fileId: string;
  sizeBytes: number;
}
const StoredSendFileMetadataSchema = v.looseObject({
  id: v.optional(v.unknown()),
  Id: v.optional(v.unknown()),
  size: v.optional(v.unknown()),
  Size: v.optional(v.unknown()),
});

/** Parse current camelCase and legacy Bitwarden PascalCase file metadata. */
export function parseStoredSendFileMetadata(
  value: unknown,
): StoredSendFileMetadata | null {
  const data = safeParseJsonWithSchema(
    String(value || ""),
    StoredSendFileMetadataSchema,
  );
  if (!data) return null;
  const rawFileId = data.id ?? data.Id;
  const fileId = typeof rawFileId === "string" ? rawFileId.trim() : "";
  const sizeBytes = Number(data.size ?? data.Size);
  return fileId && Number.isSafeInteger(sizeBytes) && sizeBytes >= 0
    ? { fileId, sizeBytes }
    : null;
}
import { safeParseJsonWithSchema } from "@edgewarden/shared";
import * as v from "valibot";
