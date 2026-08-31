import * as v from "valibot";

const APPLE_REFERENCE_DATE_SECONDS = 978_307_200;
const LastKnownRevisionDateSchema = v.optional(
  v.pipe(
    v.union([
      v.pipe(v.string(), v.isoTimestamp()),
      v.pipe(v.number(), v.finite()),
    ]),
    // Swift's default Date encoding is seconds since 2001-01-01; Android and
    // web clients send ISO timestamps. Normalize before concurrency checks.
    v.transform((value) =>
      typeof value === "number"
        ? new Date((value + APPLE_REFERENCE_DATE_SECONDS) * 1_000).toISOString()
        : value,
    ),
  ),
);

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
  encryptedFor: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
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
  lastKnownRevisionDate: LastKnownRevisionDateSchema,
});

const CipherForOrganizationSchema = v.looseObject({
  ...CipherSchema.entries,
  organizationId: v.pipe(v.string(), v.uuid()),
});
const CollectionIdsSchema = v.pipe(
  v.array(v.pipe(v.string(), v.uuid())),
  v.minLength(1),
);

// Android serializes these wrapper properties in PascalCase while web/CLI use
// camelCase. ASP.NET accepts both casing variants, so normalize them here and
// keep the rest of the application on one typed representation.
export const CipherShareSchema = v.pipe(
  v.union([
    v.object({
      cipher: CipherForOrganizationSchema,
      collectionIds: CollectionIdsSchema,
    }),
    v.object({
      Cipher: CipherForOrganizationSchema,
      CollectionIds: CollectionIdsSchema,
    }),
  ]),
  v.transform((body) =>
    "cipher" in body
      ? body
      : { cipher: body.Cipher, collectionIds: body.CollectionIds },
  ),
);

export const CipherPartialSchema = v.object({
  folderId: v.optional(v.nullable(v.pipe(v.string(), v.uuid()))),
  favorite: v.boolean(),
});

export const CipherCollectionsSchema = v.object({
  collectionIds: v.array(v.pipe(v.string(), v.uuid())),
});

export const CipherBulkCollectionsSchema = v.object({
  organizationId: v.pipe(v.string(), v.uuid()),
  cipherIds: v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.minLength(1)),
  collectionIds: v.pipe(v.array(v.pipe(v.string(), v.uuid())), v.minLength(1)),
  removeCollections: v.optional(v.boolean(), false),
});

const CiphersForOrganizationSchema = v.pipe(
  v.array(
    v.looseObject({
      ...CipherSchema.entries,
      id: v.pipe(v.string(), v.uuid()),
      organizationId: v.pipe(v.string(), v.uuid()),
    }),
  ),
  v.minLength(1),
);

export const CipherBulkShareSchema = v.pipe(
  v.union([
    v.object({
      collectionIds: CollectionIdsSchema,
      ciphers: CiphersForOrganizationSchema,
    }),
    v.object({
      CollectionIds: CollectionIdsSchema,
      Ciphers: CiphersForOrganizationSchema,
    }),
  ]),
  v.transform((body) =>
    "ciphers" in body
      ? body
      : { ciphers: body.Ciphers, collectionIds: body.CollectionIds },
  ),
  v.check(
    (body) =>
      new Set(body.ciphers.map((cipher) => cipher.organizationId)).size === 1,
    "All ciphers must be for the same organization",
  ),
  v.check(
    (body) =>
      new Set(body.ciphers.map((cipher) => cipher.id)).size ===
      body.ciphers.length,
    "Cipher IDs must be unique",
  ),
);

export const CipherPurgeSchema = v.object({
  secret: v.pipe(v.string(), v.minLength(1)),
});

export const CipherPurgeQuerySchema = v.object({
  organizationId: v.optional(v.pipe(v.string(), v.uuid())),
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
export type CipherShareInput = v.InferOutput<typeof CipherShareSchema>;
export type CipherPartialInput = v.InferOutput<typeof CipherPartialSchema>;
export type CipherCollectionsInput = v.InferOutput<
  typeof CipherCollectionsSchema
>;
export type CipherBulkCollectionsInput = v.InferOutput<
  typeof CipherBulkCollectionsSchema
>;
export type CipherBulkShareInput = v.InferOutput<typeof CipherBulkShareSchema>;
export type BulkIdsInput = v.InferOutput<typeof BulkIdsSchema>;
export type MoveCiphersInput = v.InferOutput<typeof MoveCiphersSchema>;
export type CipherImportInput = v.InferOutput<typeof CipherImportSchema>;
