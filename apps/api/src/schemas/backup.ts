import * as v from "valibot";

const nonEmptyString = v.pipe(v.string(), v.trim(), v.minLength(1));

export const BackupExportSchema = v.object({
	includeAttachments: v.optional(v.boolean(), false),
});

export const BackupSettingsSchema = v.looseObject({
	destinations: v.optional(
		v.array(
			v.looseObject({
				id: v.optional(v.string()),
				name: v.optional(v.string()),
				type: v.picklist(["r2", "s3", "e3", "webdav"]),
				includeAttachments: v.optional(v.boolean()),
				schedule: v.optional(v.record(v.string(), v.unknown())),
				destination: v.record(v.string(), v.unknown()),
			}),
		),
	),
});

export const BackupRunSchema = v.object({
	destinationId: v.optional(nonEmptyString),
});

export const BackupRemoteRestoreSchema = v.object({
	destinationId: v.optional(nonEmptyString),
	path: nonEmptyString,
	replaceExisting: v.optional(v.boolean(), false),
	allowChecksumMismatch: v.optional(v.boolean(), false),
});

export const BackupImportSchema = v.object({
	file: v.file(),
	replaceExisting: v.optional(v.picklist(["", "0", "1"]), ""),
	allowChecksumMismatch: v.optional(v.picklist(["", "0", "1"]), ""),
});

export const BackupBlobQuerySchema = v.object({
	blobName: nonEmptyString,
});

export const BackupRemoteQuerySchema = v.object({
	destinationId: v.optional(nonEmptyString),
	path: v.optional(v.string(), ""),
});

export const BackupRemoteFileQuerySchema = v.object({
	destinationId: v.optional(nonEmptyString),
	path: nonEmptyString,
});
