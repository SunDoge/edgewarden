import { normalizeEquivalentDomain } from "@edgewarden/shared";

export interface NormalizedEquivalentDomainRule {
  domains: string[];
  invalidIndexes: Set<number>;
  valid: boolean;
}

export function normalizeEquivalentDomainRule(
  domains: string[],
): NormalizedEquivalentDomainRule {
  const invalidIndexes = new Set<number>();
  const normalized = domains.map((domain, index) => {
    const value = normalizeEquivalentDomain(domain);
    if (!domain.trim() || !value) invalidIndexes.add(index);
    return value;
  });
  const uniqueDomains = [...new Set(normalized.filter(Boolean))];
  return {
    domains: uniqueDomains,
    invalidIndexes,
    valid: invalidIndexes.size === 0 && uniqueDomains.length >= 2,
  };
}

export function createEquivalentDomainRuleId(
  now = Date.now(),
  random = Math.random(),
): string {
  return `custom-${now.toString(36)}-${random.toString(36).slice(2, 8)}`;
}
