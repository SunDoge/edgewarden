import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("RPC response contracts", () => {
  it("does not JSON-decode responses in Promise<void> service functions", () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const violations: string[] = [];
    for (const file of readdirSync(directory).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    )) {
      const source = readFileSync(join(directory, file), "utf8");
      const functions = source.matchAll(
        /export async function\s+(\w+)\s*\([\s\S]*?\): Promise<void>\s*\{([\s\S]*?)\n\}/g,
      );
      for (const match of functions) {
        if (/\brpcJson\s*\(/.test(match[2]))
          violations.push(`${file}:${match[1]}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
