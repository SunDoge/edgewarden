import { describe, expect, it } from "vitest";
import {
  createEquivalentDomainRuleId,
  normalizeEquivalentDomainRule,
} from "./equivalent-domains";

describe("equivalent domain rules", () => {
  it("normalizes and deduplicates valid domains", () => {
    expect(
      normalizeEquivalentDomainRule([
        "https://Example.com/login",
        "example.com",
        "sub.example.net",
      ]),
    ).toMatchObject({
      domains: ["example.com", "example.net"],
      valid: true,
    });
  });

  it("reports invalid source indexes and requires two unique domains", () => {
    const result = normalizeEquivalentDomainRule(["example.com", " "]);
    expect([...result.invalidIndexes]).toEqual([1]);
    expect(result.valid).toBe(false);
  });

  it("creates deterministic ids when dependencies are supplied", () => {
    expect(createEquivalentDomainRuleId(36, 0.5)).toBe("custom-10-i");
  });
});
