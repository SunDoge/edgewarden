import { expect, test } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh-CN.json";

test("English and Chinese catalogs have matching keys and placeholders", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(en[key].trim(), key).not.toBe("");
    expect(en[key], key).not.toMatch(/\p{Script=Han}/u);
    expect(zh[key].trim(), key).not.toBe("");
    const placeholders = (message: string) =>
      [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]));
  }
});
