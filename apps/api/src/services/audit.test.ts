import assert from "node:assert/strict";
import { test } from "vitest";
import {
  MAX_AUDIT_METADATA_BYTES,
  MAX_AUDIT_METADATA_STRING_BYTES,
  serializeAuditMetadata,
} from "./audit";

const utf8 = new TextEncoder();

test("serializes only bounded, non-sensitive audit metadata", () => {
  const serialized = serializeAuditMetadata({
    method: "DELETE",
    path: "/api/ciphers/example",
    password: "must-not-survive",
    token: "must-not-survive",
    type: ["one", "two", "three"],
    reason: { nested: "objects-are-not-accepted" },
    size: Number.POSITIVE_INFINITY,
  });
  assert.deepEqual(JSON.parse(serialized), {
    method: "DELETE",
    path: "/api/ciphers/example",
    type: 3,
  });
});

test("truncates audit strings on a valid UTF-8 character boundary", () => {
  const serialized = serializeAuditMetadata({ userAgent: "密🔐".repeat(1000) });
  const metadata = JSON.parse(serialized) as { userAgent: string };
  assert.ok(
    utf8.encode(metadata.userAgent).byteLength <=
      MAX_AUDIT_METADATA_STRING_BYTES,
  );
  assert.equal(metadata.userAgent.includes("�"), false);
  assert.ok("密🔐".repeat(1000).startsWith(metadata.userAgent));
});

test("keeps the complete audit metadata JSON within its storage budget", () => {
  const serialized = serializeAuditMetadata({
    method: "M".repeat(5000),
    path: "P".repeat(5000),
    ip: "I".repeat(5000),
    userAgent: "U".repeat(5000),
    email: "E".repeat(5000),
    targetEmail: "T".repeat(5000),
    reason: "R".repeat(5000),
    error: "X".repeat(5000),
  });
  assert.ok(utf8.encode(serialized).byteLength <= MAX_AUDIT_METADATA_BYTES);
  assert.doesNotThrow(() => JSON.parse(serialized));
});
