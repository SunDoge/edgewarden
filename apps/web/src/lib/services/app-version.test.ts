import { EDGEWARDEN_VERSION } from "@edgewarden/shared";
import { describe, expect, it, vi } from "vitest";
import { loadAppVersion } from "./app-version";

describe("app version", () => {
  it("reports the versions returned by the running server", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        edgewardenVersion: "1.2.3",
        version: "2026.6.0",
      }),
    );

    await expect(loadAppVersion(fetchImpl)).resolves.toEqual({
      edgewarden: "1.2.3",
      bitwardenCompatibility: "2026.6.0",
    });
    expect(fetchImpl).toHaveBeenCalledWith("/api/version", {
      cache: "no-store",
    });
  });

  it("keeps the bundled version when the server cannot be queried", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });

    await expect(loadAppVersion(fetchImpl)).resolves.toEqual({
      edgewarden: EDGEWARDEN_VERSION,
      bitwardenCompatibility: null,
    });
  });

  it("ignores malformed fields from an incompatible server", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ edgewardenVersion: 123, version: null }),
    );

    await expect(loadAppVersion(fetchImpl)).resolves.toEqual({
      edgewarden: EDGEWARDEN_VERSION,
      bitwardenCompatibility: null,
    });
  });
});
