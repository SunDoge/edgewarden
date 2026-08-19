import * as v from "valibot";

const encrypted = v.pipe(v.string(), v.minLength(3), v.maxLength(16384));

export const CreateOrganizationSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
  collectionName: encrypted,
  key: encrypted,
  publicKey: v.optional(v.pipe(v.string(), v.minLength(32), v.maxLength(8192))),
  encryptedPrivateKey: v.optional(encrypted),
});

export const UpdateOrganizationSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
});
export const DeleteOrganizationSchema = v.object({
  masterPasswordHash: v.pipe(v.string(), v.minLength(1)),
});

export const InviteOrganizationMemberSchema = v.object({
  email: v.pipe(v.string(), v.email()),
  role: v.optional(v.picklist(["admin", "manager", "member"]), "member"),
  accessAll: v.optional(v.boolean(), true),
  collections: v.optional(
    v.array(
      v.object({
        id: v.pipe(v.string(), v.minLength(1)),
        readOnly: v.optional(v.boolean(), false),
        hidePasswords: v.optional(v.boolean(), false),
      }),
    ),
    [],
  ),
  key: encrypted,
});
export const UpdateOrganizationMemberSchema = v.object({
  role: v.picklist(["admin", "manager", "member"]),
  accessAll: v.boolean(),
  collections: v.optional(
    v.array(
      v.object({
        id: v.pipe(v.string(), v.minLength(1)),
        readOnly: v.optional(v.boolean(), false),
        hidePasswords: v.optional(v.boolean(), false),
      }),
    ),
    [],
  ),
});
export const OrganizationInviteeQuerySchema = v.object({
  email: v.pipe(v.string(), v.email()),
});

export const CreateCollectionSchema = v.object({ name: encrypted });
export const UpdateCollectionSchema = v.object({ name: encrypted });

export type CreateOrganizationInput = v.InferOutput<
  typeof CreateOrganizationSchema
>;
export type UpdateOrganizationInput = v.InferOutput<
  typeof UpdateOrganizationSchema
>;
export type InviteOrganizationMemberInput = v.InferOutput<
  typeof InviteOrganizationMemberSchema
>;
export type CreateCollectionInput = v.InferOutput<
  typeof CreateCollectionSchema
>;
