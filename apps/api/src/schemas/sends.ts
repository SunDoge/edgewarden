import * as v from "valibot";

const sendType = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1));
const authType = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(2));
const count = v.pipe(v.number(), v.integer(), v.minValue(0));
const encryptedString = v.pipe(v.string(), v.trim(), v.minLength(1));
const dateString = v.pipe(v.string(), v.isoTimestamp());
const deletionDateString = v.pipe(
  dateString,
  v.check((value) => {
    const deletionTime = new Date(value).getTime();
    const remaining = deletionTime - Date.now();
    return remaining > 0 && remaining <= 30 * 24 * 60 * 60 * 1000;
  }, "Send deletionDate must be in the future and no more than 30 days away"),
);

const sendAliases = {
  type: v.optional(sendType),
  Type: v.optional(sendType),
  name: v.optional(encryptedString),
  Name: v.optional(encryptedString),
  key: v.optional(encryptedString),
  Key: v.optional(encryptedString),
  notes: v.optional(v.nullable(v.string())),
  Notes: v.optional(v.nullable(v.string())),
  password: v.optional(v.nullable(v.string())),
  Password: v.optional(v.nullable(v.string())),
  authType: v.optional(authType),
  AuthType: v.optional(authType),
  emails: v.optional(v.nullable(v.array(v.pipe(v.string(), v.email())))),
  maxAccessCount: v.optional(v.nullable(count)),
  MaxAccessCount: v.optional(v.nullable(count)),
  disabled: v.optional(v.boolean()),
  Disabled: v.optional(v.boolean()),
  hideEmail: v.optional(v.boolean()),
  HideEmail: v.optional(v.boolean()),
  expirationDate: v.optional(v.nullable(dateString)),
  ExpirationDate: v.optional(v.nullable(dateString)),
  deletionDate: v.optional(deletionDateString),
  DeletionDate: v.optional(deletionDateString),
};

export const CreateTextSendSchema = v.pipe(
  v.looseObject({
    ...sendAliases,
    text: v.optional(v.record(v.string(), v.unknown())),
    Text: v.optional(v.record(v.string(), v.unknown())),
  }),
  v.check(
    (body) =>
      (body.type ?? body.Type) === 0 &&
      Boolean(body.name ?? body.Name) &&
      Boolean(body.key ?? body.Key) &&
      Boolean(body.deletionDate ?? body.DeletionDate) &&
      Boolean(body.text ?? body.Text) &&
      ((body.authType ?? body.AuthType) !== 1 ||
        Boolean(body.password ?? body.Password)),
    "A text Send requires type, name, key, deletionDate and text",
  ),
);

export const CreateFileSendSchema = v.pipe(
  v.looseObject({
    ...sendAliases,
    fileLength: v.optional(count),
    FileLength: v.optional(count),
    file: v.optional(v.record(v.string(), v.unknown())),
    File: v.optional(v.record(v.string(), v.unknown())),
  }),
  v.check(
    (body) =>
      (body.type ?? body.Type) === 1 &&
      (body.fileLength ?? body.FileLength) !== undefined &&
      Boolean(body.name ?? body.Name) &&
      Boolean(body.key ?? body.Key) &&
      Boolean(body.deletionDate ?? body.DeletionDate) &&
      Boolean(body.file ?? body.File) &&
      ((body.authType ?? body.AuthType) !== 1 ||
        Boolean(body.password ?? body.Password)),
    "A file Send requires type, fileLength, name, key, deletionDate and file",
  ),
);

export const UpdateSendSchema = v.pipe(
  v.looseObject({
    ...sendAliases,
    text: v.optional(v.record(v.string(), v.unknown())),
    Text: v.optional(v.record(v.string(), v.unknown())),
  }),
  v.check(
    (body) =>
      (body.authType ?? body.AuthType) !== 1 ||
      Boolean(body.password ?? body.Password),
    "Password authentication requires a password",
  ),
);

export const SendAccessSchema = v.looseObject({
  password: v.optional(v.string()),
  Password: v.optional(v.string()),
  passwordHash: v.optional(v.string()),
  PasswordHash: v.optional(v.string()),
  password_hash_b64: v.optional(v.string()),
});
