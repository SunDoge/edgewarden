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

export const SetVerifyDevicesSchema = v.looseObject({
  verifyDevices: v.boolean(),
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});
