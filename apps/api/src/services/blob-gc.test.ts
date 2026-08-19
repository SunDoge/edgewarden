import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { discardUnpublishedBlob } from "./blob-gc";

describe("blob garbage collection", () => {
  test("keeps the object when D1 cannot durably enqueue its deletion", async () => {
    let deleteCalls = 0;
    const env = {
      DB: {
        batch: async () => {
          throw new Error("simulated D1 outage");
        },
        prepare: () => ({ bind: () => ({}) }),
      },
      ATTACHMENT_STORAGE: "r2",
      ATTACHMENTS_R2: {
        delete: async () => {
          deleteCalls += 1;
        },
      },
    } as unknown as CloudflareBindings;

    await assert.rejects(
      discardUnpublishedBlob(env, "attachments/cipher/attachment.bin"),
      /simulated D1 outage/,
    );
    assert.equal(deleteCalls, 0);
  });
});
