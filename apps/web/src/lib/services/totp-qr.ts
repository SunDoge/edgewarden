import * as m from "$lib/paraglide/messages.js";
import QrScanner from "qr-scanner";
import { extractTotpSecret } from "./crypto";

export function normalizeTotpQrValue(raw: string): string | null {
  const value = raw.trim();
  if (!/^(?:otpauth:\/\/totp|steam:\/\/)/i.test(value)) return null;
  return extractTotpSecret(value) ? value : null;
}

export async function scanTotpQrFile(file: File): Promise<string> {
  const result = await QrScanner.scanImage(file, {
    returnDetailedScanResult: true,
  });
  const value = normalizeTotpQrValue(result.data);
  if (!value)
    throw new Error(m.ui_the_qr_code_does_not_contain_valid_totp_settings());
  return value;
}
