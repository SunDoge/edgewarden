import * as v from "valibot";

export const FolderSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
});

export type FolderInput = v.InferOutput<typeof FolderSchema>;
