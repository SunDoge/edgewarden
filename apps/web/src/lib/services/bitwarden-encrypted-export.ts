import * as m from "$lib/paraglide/messages.js";
import { argon2id } from "hash-wasm";
import {
  bytesToBase64,
  decryptStr,
  encryptStr,
  hkdfExpand,
  pbkdf2,
} from "./crypto";

interface PasswordProtectedExport {
  encrypted: true;
  passwordProtected: true;
  salt: string;
  kdfType: number;
  kdfIterations: number;
  kdfMemory?: number;
  kdfParallelism?: number;
  encKeyValidation_DO_NOT_EDIT: string;
  data: string;
}

const MAX_PBKDF2_ITERATIONS = 10_000_000;
const MAX_ARGON2_ITERATIONS = 100;
const MAX_ARGON2_MEMORY_MIB = 1024;
const MAX_ARGON2_PARALLELISM = 16;
const EXPORT_PBKDF2_ITERATIONS = 600_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isPasswordProtectedExport(
  value: unknown,
): value is PasswordProtectedExport {
  return (
    isRecord(value) &&
    value.encrypted === true &&
    value.passwordProtected === true
  );
}

function positiveInteger(
  value: unknown,
  field: string,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > maximum
  ) {
    throw new Error(
      m.ui_invalid_value_parameter_in_bitwarden_encrypted_export({
        value0: field,
      }),
    );
  }
  return Number(value);
}

async function deriveExportKey(
  document: PasswordProtectedExport,
  password: string,
) {
  if (!password)
    throw new Error(m.ui_enter_your_bitwarden_encrypted_export_password());
  if (typeof document.salt !== "string" || !document.salt)
    throw new Error(m.ui_bitwarden_encrypted_export_is_missing_its_salt());
  const iterations = positiveInteger(
    document.kdfIterations,
    "kdfIterations",
    document.kdfType === 0 ? MAX_PBKDF2_ITERATIONS : MAX_ARGON2_ITERATIONS,
  );
  let material: Uint8Array;
  if (document.kdfType === 0) {
    material = await pbkdf2(password, document.salt, iterations, 32);
  } else if (document.kdfType === 1) {
    const memory = positiveInteger(
      document.kdfMemory,
      "kdfMemory",
      MAX_ARGON2_MEMORY_MIB,
    );
    const parallelism = positiveInteger(
      document.kdfParallelism,
      "kdfParallelism",
      MAX_ARGON2_PARALLELISM,
    );
    material = await argon2id({
      password,
      salt: document.salt,
      iterations,
      parallelism,
      memorySize: memory * 1024,
      hashLength: 32,
      outputType: "binary",
    });
  } else {
    throw new Error(m.ui_unsupported_kdf_type_in_bitwarden_encrypted_export());
  }
  return {
    encKey: await hkdfExpand(material, "enc", 32),
    macKey: await hkdfExpand(material, "mac", 32),
  };
}

export async function decryptPasswordProtectedExport(
  document: unknown,
  password: string,
): Promise<string> {
  if (!isPasswordProtectedExport(document)) {
    throw new Error(
      m.ui_this_is_not_a_bitwarden_password_protected_json_export(),
    );
  }
  if (
    typeof document.encKeyValidation_DO_NOT_EDIT !== "string" ||
    typeof document.data !== "string" ||
    !document.encKeyValidation_DO_NOT_EDIT ||
    !document.data
  ) {
    throw new Error(m.ui_bitwarden_encrypted_export_is_incomplete());
  }
  const { encKey, macKey } = await deriveExportKey(document, password);
  try {
    await decryptStr(document.encKeyValidation_DO_NOT_EDIT, encKey, macKey);
    return await decryptStr(document.data, encKey, macKey);
  } catch {
    throw new Error(m.ui_incorrect_export_password_or_damaged_encrypted_file());
  }
}

/**
 * Produces Bitwarden's portable password-protected JSON envelope. Unlike an
 * account-restricted export, this can be restored into a different account or
 * server. The plaintext and password are handled only by the browser.
 */
export async function encryptPasswordProtectedExport(
  plaintext: string,
  password: string,
): Promise<string> {
  if (!password)
    throw new Error(m.ui_enter_an_encryption_password_for_the_export());

  const document: PasswordProtectedExport = {
    encrypted: true,
    passwordProtected: true,
    salt: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
    kdfType: 0,
    kdfIterations: EXPORT_PBKDF2_ITERATIONS,
    encKeyValidation_DO_NOT_EDIT: "",
    data: "",
  };
  const { encKey, macKey } = await deriveExportKey(document, password);
  document.encKeyValidation_DO_NOT_EDIT = await encryptStr(
    crypto.randomUUID(),
    encKey,
    macKey,
  );
  document.data = await encryptStr(plaintext, encKey, macKey);
  return JSON.stringify(document, null, 2);
}
