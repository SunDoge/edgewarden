import { argon2id } from "hash-wasm";
import { decryptStr, hkdfExpand, pbkdf2 } from "./crypto";

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
    throw new Error(`Bitwarden 加密导出的 ${field} 参数无效`);
  }
  return Number(value);
}

async function deriveExportKey(
  document: PasswordProtectedExport,
  password: string,
) {
  if (!password) throw new Error("请输入 Bitwarden 加密导出密码");
  if (typeof document.salt !== "string" || !document.salt)
    throw new Error("Bitwarden 加密导出缺少 salt");
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
    throw new Error("不支持此 Bitwarden 加密导出的 KDF 类型");
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
    throw new Error("这不是 Bitwarden 密码保护加密 JSON");
  }
  if (
    typeof document.encKeyValidation_DO_NOT_EDIT !== "string" ||
    typeof document.data !== "string" ||
    !document.encKeyValidation_DO_NOT_EDIT ||
    !document.data
  ) {
    throw new Error("Bitwarden 加密导出结构不完整");
  }
  const { encKey, macKey } = await deriveExportKey(document, password);
  try {
    await decryptStr(document.encKeyValidation_DO_NOT_EDIT, encKey, macKey);
    return await decryptStr(document.data, encKey, macKey);
  } catch {
    throw new Error("导出密码错误或加密文件已损坏");
  }
}
