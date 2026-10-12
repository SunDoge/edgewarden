import { expect, test } from "vitest";
import * as v from "valibot";
import { CipherCreateSchema, CipherShareSchema } from "./ciphers";

const cipher = {
  type: 1,
  name: "encrypted-name",
  organizationId: null,
  login: { username: "encrypted-user", password: "encrypted-password" },
};

test.each(["camel", "pascal"])(
  "accepts %s personal create wrappers",
  (casing) => {
    for (const ids of [[], null, undefined]) {
      const input =
        casing === "camel"
          ? { cipher, collectionIds: ids }
          : { Cipher: cipher, CollectionIds: ids };
      const result = v.safeParse(CipherCreateSchema, input);
      expect(result.success).toBe(true);
      if (result.success)
        expect(result.output).toMatchObject({ cipher, collectionIds: [] });
      expect(v.safeParse(CipherShareSchema, input).success).toBe(false);
    }
  },
);

test("rejects invalid nested ciphers and collection IDs", () => {
  for (const input of [
    { cipher: { ...cipher, type: "1" }, collectionIds: [] },
    { cipher: { ...cipher, name: "" }, collectionIds: [] },
    { cipher: null, collectionIds: [] },
    { cipher, collectionIds: ["invalid"] },
    { cipher, collectionIds: "invalid" },
  ])
    expect(v.safeParse(CipherCreateSchema, input).success).toBe(false);
});
