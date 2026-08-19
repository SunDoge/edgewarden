import * as v from "valibot";

export const CipherSchema = v.looseObject({
  type: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(8)),
  name: v.pipe(v.string(), v.minLength(1)),
  notes: v.optional(v.nullable(v.string())),
  folderId: v.optional(v.nullable(v.string())),
  organizationId: v.optional(v.nullable(v.string())),
  collectionIds: v.optional(v.array(v.pipe(v.string(), v.minLength(1))), []),
  favorite: v.optional(v.boolean()),
  reprompt: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1)),
  ),
  key: v.optional(v.nullable(v.string())),
  // Type-specific data — stored as opaque JSON, validated loosely
  login: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
  card: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
  identity: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
  secureNote: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
  sshKey: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
  bankAccount: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
  driversLicense: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
  passport: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
  fields: v.optional(v.nullable(v.array(v.record(v.string(), v.unknown())))),
  passwordHistory: v.optional(
    v.nullable(v.array(v.record(v.string(), v.unknown()))),
  ),
  // Official clients send the revision they last observed. The API uses it for
  // optimistic concurrency control so an offline client cannot silently replace
  // a newer edit.
  lastKnownRevisionDate: v.optional(v.pipe(v.string(), v.isoTimestamp())),
});

export const BulkIdsSchema = v.object({
  ids: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1)),
});

export const MoveCiphersSchema = v.object({
  ids: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1)),
  folderId: v.nullable(v.string()),
});

export const CipherImportSchema = v.object({
  folders: v.optional(
    v.array(
      v.object({
        id: v.optional(v.pipe(v.string(), v.minLength(1))),
        name: v.pipe(v.string(), v.minLength(1)),
      }),
    ),
    [],
  ),
  ciphers: v.optional(
    v.array(
      v.looseObject({
        ...CipherSchema.entries,
        id: v.optional(v.nullable(v.string())),
      }),
    ),
    [],
  ),
  folderRelationships: v.optional(
    v.array(
      v.object({
        key: v.pipe(v.number(), v.integer(), v.minValue(0)),
        value: v.pipe(v.number(), v.integer(), v.minValue(0)),
      }),
    ),
    [],
  ),
});

export type CipherInput = v.InferOutput<typeof CipherSchema>;
export type BulkIdsInput = v.InferOutput<typeof BulkIdsSchema>;
export type MoveCiphersInput = v.InferOutput<typeof MoveCiphersSchema>;
export type CipherImportInput = v.InferOutput<typeof CipherImportSchema>;
