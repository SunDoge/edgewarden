import {
  parseJsonWithSchema,
  safeParseJsonWithSchema,
} from "@edgewarden/shared";
import * as v from "valibot";
import { describe, expect, it } from "vitest";

const StoredValueSchema = v.object({
  enabled: v.boolean(),
  labels: v.array(v.string()),
});

describe("validated JSON boundaries", () => {
  it("returns typed data only when the complete shape is valid", () => {
    expect(
      parseJsonWithSchema(
        '{"enabled":true,"labels":["one","two"]}',
        StoredValueSchema,
      ),
    ).toEqual({ enabled: true, labels: ["one", "two"] });
  });

  it("rejects valid JSON with the wrong persisted shape", () => {
    expect(
      safeParseJsonWithSchema(
        '{"enabled":"true","labels":[1]}',
        StoredValueSchema,
      ),
    ).toBeNull();
    expect(safeParseJsonWithSchema("not-json", StoredValueSchema)).toBeNull();
  });
});
