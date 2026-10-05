import { EDGEWARDEN_VERSION } from "@edgewarden/shared";

export interface AppVersionInfo {
  edgewarden: string;
  bitwardenCompatibility: string | null;
}

/**
 * Reads the running server's version instead of assuming the deployed API and
 * web bundle were released together.
 */
export async function loadAppVersion(
  fetchImpl: typeof fetch = fetch,
): Promise<AppVersionInfo> {
  const fallback: AppVersionInfo = {
    edgewarden: EDGEWARDEN_VERSION,
    bitwardenCompatibility: null,
  };

  try {
    const response = await fetchImpl("/api/version", { cache: "no-store" });
    if (!response.ok) return fallback;

    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return fallback;

    const version = body as Record<string, unknown>;
    return {
      edgewarden:
        typeof version.edgewardenVersion === "string"
          ? version.edgewardenVersion
          : fallback.edgewarden,
      bitwardenCompatibility:
        typeof version.version === "string" ? version.version : null,
    };
  } catch {
    return fallback;
  }
}
