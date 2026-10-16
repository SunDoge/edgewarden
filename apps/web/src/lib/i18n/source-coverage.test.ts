import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parse } from "svelte/compiler";
import ts from "typescript";
import { expect, test } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
// These are language names and multilingual search tokens, not untranslated UI.
const allowed: Record<string, string[]> = {
  "lib/components/LanguageSwitcher.svelte": ["简体中文"],
  "lib/services/admin-search.ts": [
    "2fa two-factor enabled 已启用",
    "2fa two-factor disabled 未启用",
  ],
};

test("production UI has no hard-coded Chinese copy outside the catalogs", () => {
  const failures: string[] = [];
  for (const file of readdirSync(sourceRoot, { recursive: true }).map(String)) {
    if (
      !/\.(svelte|ts)$/.test(file) ||
      /(?:\.test\.|\.spec\.|paraglide\/|test\/)/.test(file)
    )
      continue;
    const source = readFileSync(join(sourceRoot, file), "utf8");
    const report = (value: string, offset: number) => {
      if (!/\p{Script=Han}/u.test(value) || allowed[file]?.includes(value))
        return;
      const line = source.slice(0, offset).split("\n").length;
      failures.push(`${file}:${line}: ${value}`);
    };
    if (file.endsWith(".svelte")) {
      const visit = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        const n = node as Record<string, unknown>;
        if (n.type === "Comment") return;
        if (n.type === "Text") report(String(n.data), Number(n.start));
        if (n.type === "Literal" && typeof n.value === "string")
          report(n.value, Number(n.start));
        if (n.type === "TemplateElement")
          report(
            String((n.value as { cooked: string }).cooked),
            Number(n.start),
          );
        for (const [key, value] of Object.entries(n)) {
          if (["loc", "metadata"].includes(key)) continue;
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === "object") visit(value);
        }
      };
      visit(parse(source, { modern: true }));
    } else {
      const ast = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isStringLiteralLike(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        )
          report(node.text, node.getStart(ast));
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
  }
  expect(failures).toEqual([]);
});
