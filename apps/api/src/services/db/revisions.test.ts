import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { readAtStableRevision } from "./revisions";

describe("stable revision reads", () => {
  test("retries a read that crossed a revision change", async () => {
    const revisions = [1, 2, 2, 2];
    let reads = 0;
    const result = await readAtStableRevision({
      readRevision: async () => revisions.shift() ?? 2,
      read: async () => ++reads,
    });

    assert.equal(result, 2);
    assert.equal(reads, 2);
  });

  test("fails closed when every read crosses a revision change", async () => {
    let revision = 0;
    const result = await readAtStableRevision({
      readRevision: async () => revision++,
      read: async () => "mixed",
      maxAttempts: 3,
    });

    assert.equal(result, null);
  });
});
