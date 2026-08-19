import { describe, expect, it, vi } from "vitest";
import { MAX_BACKUP_ARCHIVE_BYTES } from "./limits";
import {
  downloadFromR2,
  listR2Entries,
  putToR2,
  type R2BackupBucket,
} from "./r2-adapter";

function createBucket(overrides: Partial<R2BackupBucket> = {}): R2BackupBucket {
  return {
    head: vi.fn().mockResolvedValue(null),
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({
      objects: [],
      delimitedPrefixes: [],
      truncated: false,
    }),
    ...overrides,
  };
}

describe("R2 backup adapter", () => {
  it("always writes beneath the reserved backups prefix", async () => {
    const bucket = createBucket();

    await putToR2(bucket, "daily/archive.zip", new Uint8Array([1, 2, 3]), {
      contentType: "application/zip",
    });

    expect(bucket.put).toHaveBeenCalledWith(
      "backups/daily/archive.zip",
      expect.any(Uint8Array),
      { httpMetadata: { contentType: "application/zip" } },
    );
    await expect(
      putToR2(bucket, "../attachments/item", new Uint8Array()),
    ).rejects.toThrow("Invalid remote backup path");
  });

  it("lists only direct children under the reserved prefix", async () => {
    const bucket = createBucket({
      list: vi.fn().mockResolvedValue({
        objects: [
          {
            key: "backups/archive.zip",
            size: 42,
            uploaded: new Date("2026-08-16T01:02:03.000Z"),
          },
        ],
        delimitedPrefixes: ["backups/attachments/"],
        truncated: false,
      }),
    });

    const result = await listR2Entries(bucket, "");

    expect(bucket.list).toHaveBeenCalledWith({
      prefix: "backups/",
      delimiter: "/",
      cursor: undefined,
      include: ["httpMetadata"],
    });
    expect(result.items).toMatchObject([
      { path: "attachments", isDirectory: true },
      { path: "archive.zip", size: 42, isDirectory: false },
    ]);
  });

  it("rejects oversized objects before reading their bodies", async () => {
    const arrayBuffer = vi.fn();
    const bucket = createBucket({
      get: vi.fn().mockResolvedValue({
        size: MAX_BACKUP_ARCHIVE_BYTES + 1,
        arrayBuffer,
      }),
    });

    await expect(downloadFromR2(bucket, "archive.zip")).rejects.toThrow(
      "exceeds the restore size limit",
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
