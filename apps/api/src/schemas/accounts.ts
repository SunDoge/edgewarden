export {
  type ChangePasswordInput,
  ChangePasswordSchema,
  type RegisterInput,
  RegisterSchema,
  type SetKeysInput,
  SetKeysSchema,
  type UpdateProfileInput,
  UpdateProfileSchema,
  type VerifyPasswordInput,
  VerifyPasswordSchema,
} from "@edgewarden/shared";

import * as v from "valibot";

// Bitwarden KeyId is exactly 16 bytes encoded as lowercase hexadecimal.
const UserKeyIdSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{32}$/));
export const SetUserKeyIdSchema = v.pipe(
  v.union([
    v.object({ userKeyId: UserKeyIdSchema }),
    v.object({ UserKeyId: UserKeyIdSchema }),
  ]),
  v.transform((body) =>
    "userKeyId" in body ? body : { userKeyId: body.UserKeyId },
  ),
);

export const SetVerifyDevicesSchema = v.looseObject({
  verifyDevices: v.boolean(),
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});
