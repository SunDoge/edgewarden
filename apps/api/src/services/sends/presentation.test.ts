import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { parseStoredSendFileMetadata } from "./file-metadata";
import { parseStoredSendData } from "./presentation";

describe("stored Send presentation", () => {
  test("normalizes legacy PascalCase file metadata", () => {
    assert.deepEqual(
      parseStoredSendData({
        data: JSON.stringify({
          Id: "file-id",
          Size: 42,
          SizeName: "42 Bytes",
          FileName: "encrypted-name",
        }),
      }),
      {
        Id: "file-id",
        Size: 42,
        SizeName: "42 Bytes",
        FileName: "encrypted-name",
        id: "file-id",
        size: 42,
        sizeName: "42 Bytes",
        fileName: "encrypted-name",
      },
    );
  });

  test("parses legacy file identifiers and sizes for storage operations", () => {
    assert.deepEqual(
      parseStoredSendFileMetadata(
        JSON.stringify({ Id: " file-id ", Size: 42 }),
      ),
      { fileId: "file-id", sizeBytes: 42 },
    );
    assert.equal(
      parseStoredSendFileMetadata(JSON.stringify({ Id: "file-id", Size: -1 })),
      null,
    );
  });
});
