import * as v from "valibot";

export const CreateAttachmentSchema = v.object({
  fileName: v.pipe(v.string(), v.minLength(1)),
  key: v.pipe(v.string(), v.minLength(1)),
  // Android's SDK model serializes byte counts as strings; iOS and the CLI use
  // numbers. Normalize both representations before enforcing storage limits.
  fileSize: v.pipe(
    v.union([
      v.number(),
      v.pipe(
        v.string(),
        v.regex(/^\d+$/),
        v.transform((value) => Number(value)),
      ),
    ]),
    v.integer(),
    v.minValue(1),
  ),
});
