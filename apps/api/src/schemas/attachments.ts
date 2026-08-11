import * as v from "valibot";

export const CreateAttachmentSchema = v.object({
	fileName: v.pipe(v.string(), v.minLength(1)),
	key: v.pipe(v.string(), v.minLength(1)),
	fileSize: v.pipe(v.number(), v.integer(), v.minValue(1)),
});
