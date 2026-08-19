import { safeParseJsonWithSchema } from "@edgewarden/shared";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import * as v from "valibot";

const ClientDataSchema = v.object({
  type: v.optional(v.string()),
  challenge: v.optional(v.string()),
  origin: v.optional(v.string()),
});

export function bytesToBase64Url(bytes: Uint8Array): string {
  return isoBase64URL.fromBuffer(Uint8Array.from(bytes));
}

export function base64UrlToBytes(
  input: string,
): ReturnType<Uint8Array["slice"]> {
  return isoBase64URL.toBuffer(input);
}

export function randomChallenge(size = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export function parseClientDataJSON(
  base64Url: string,
): { type?: string; challenge?: string; origin?: string } | null {
  try {
    const text = isoBase64URL.toUTF8String(base64Url);
    return safeParseJsonWithSchema(text, ClientDataSchema);
  } catch {
    return null;
  }
}
