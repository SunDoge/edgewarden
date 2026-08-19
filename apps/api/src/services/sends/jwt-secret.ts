import { LIMITS } from "../../config";

export function getSafeSendJwtSecret(env: CloudflareBindings): string | null {
  const secret = (env.JWT_SECRET || "").trim();
  return secret.length >= LIMITS.auth.jwtSecretMinLength ? secret : null;
}
