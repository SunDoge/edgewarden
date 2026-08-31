import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { parseStoredSendFileMetadata } from "./file-metadata";
import { parseStoredSendData, sendToResponse } from "./presentation";

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

  test("serializes email authentication using the official string contract", () => {
    const response = sendToResponse({
      id: "00000000-0000-0000-0000-000000000001",
      user_id: "user-id",
      org_id: null,
      type: 0,
      name: "2.name",
      notes: null,
      data: JSON.stringify({ text: "2.text", hidden: false }),
      key: "2.key",
      max_access_count: null,
      access_count: 0,
      password_hash: null,
      password_salt: null,
      password_iterations: null,
      password_algorithm: null,
      emails: JSON.stringify(["a@example.com", "b@example.com"]),
      auth_type: 1,
      disabled: 0,
      hide_email: 0,
      expiration_date: null,
      deletion_date: 1,
      created_at: 1,
      updated_at: 1,
      purge_token: null,
      storage_key: null,
    });
    assert.equal(response.emails, "a@example.com,b@example.com");
  });
});
