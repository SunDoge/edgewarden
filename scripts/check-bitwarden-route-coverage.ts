import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

interface Route {
  method: string;
  path: string;
  source: string;
}

function walk(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? walk(path, extension)
      : entry.isFile() && entry.name.endsWith(extension)
        ? [path]
        : [];
  });
}

function normalizePath(path: string): string {
  const withoutQuery = path.split("?")[0].replace(/^~\//, "/");
  const parameters = withoutQuery
    .replace(/\{[^}/]+\}/g, ":parameter")
    .replace(/:[A-Za-z_][\w]*/g, ":parameter");
  const normalized = `/${parameters}`
    .replace(/^\/+/, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
  return normalized.replace(/^\/api(?=\/|$)/, "") || "/";
}

function key(route: Pick<Route, "method" | "path">): string {
  return `${route.method} ${normalizePath(route.path)}`;
}

function readEdgewardenRoutes(root: string): Route[] {
  const routeDirectory = resolve(root, "apps/api/src/routes");
  return walk(routeDirectory, ".ts").flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [
      ...source.matchAll(/\.(get|post|put|delete|patch)\(\s*["`]([^"`]+)["`]/g),
    ].map((match) => ({
      method: match[1].toUpperCase(),
      path: match[2],
      source: relative(root, file),
    }));
  });
}

function readBitwardenRoutes(serverRoot: string): Route[] {
  const apiRoot = resolve(serverRoot, "src/Api");
  return walk(apiRoot, ".cs").flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const classMatch = /public\s+(?:sealed\s+)?class\s+\w+Controller\b/.exec(
      source,
    );
    if (!classMatch) return [];
    const classAttributes = source.slice(0, classMatch.index);
    const prefixes = [
      ...classAttributes.matchAll(/\[Route\(\s*"([^"]*)"\s*\)\]/g),
    ];
    const prefix = prefixes.at(-1)?.[1] ?? "";
    return [
      ...source
        .slice(classMatch.index)
        .matchAll(
          /\[Http(Get|Post|Put|Delete|Patch)(?:\(\s*"([^"]*)"\s*\))?\]/g,
        ),
    ].map((match) => {
      const suffix = match[2] ?? "";
      const path = suffix.startsWith("/")
        ? suffix
        : [prefix, suffix].filter(Boolean).join("/");
      return {
        method: match[1].toUpperCase(),
        path,
        source: relative(serverRoot, file),
      };
    });
  });
}

function unique(routes: Route[]): Map<string, Route> {
  const result = new Map<string, Route>();
  for (const route of routes) result.set(key(route), route);
  return result;
}

const projectRoot = resolve(import.meta.dirname, "..");
const serverRoot = resolve(
  process.env.BITWARDEN_SERVER_DIR ??
    resolve(projectRoot, "../../csharp/server"),
);
if (!existsSync(resolve(serverRoot, "src/Api"))) {
  throw new Error(
    `Bitwarden server source not found at ${serverRoot}; set BITWARDEN_SERVER_DIR`,
  );
}

const json = process.argv.includes("--json");
const details = process.argv.includes("--details");
const failOnMissing = process.argv.includes("--fail-on-missing");
const sourceArgument = process.argv.indexOf("--source");
const sourceFilter =
  sourceArgument >= 0 ? process.argv[sourceArgument + 1] : undefined;
if (sourceArgument >= 0 && !sourceFilter)
  throw new Error("--source requires a case-insensitive path fragment");
const allUpstreamRoutes = readBitwardenRoutes(serverRoot);
const allUpstream = unique(allUpstreamRoutes);
const upstream = unique(
  allUpstreamRoutes.filter(
    (route) =>
      !sourceFilter ||
      route.source.toLowerCase().includes(sourceFilter.toLowerCase()),
  ),
);
const edgewarden = unique(readEdgewardenRoutes(projectRoot));
const covered = [...upstream.keys()].filter((route) => edgewarden.has(route));
const missing = [...upstream.entries()]
  .filter(([route]) => !edgewarden.has(route))
  .map(([route, details]) => ({ route, source: details.source }))
  .sort((left, right) => left.route.localeCompare(right.route));
const additional = [...edgewarden.entries()]
  .filter(([route]) => !allUpstream.has(route))
  .map(([route, details]) => ({ route, source: details.source }))
  .sort((left, right) => left.route.localeCompare(right.route));
const percentage = upstream.size
  ? Number(((covered.length / upstream.size) * 100).toFixed(1))
  : 100;
const modules = Object.entries(
  [...upstream.entries()].reduce<
    Record<string, { upstream: number; covered: number }>
  >((result, [route, details]) => {
    const module = details.source.split("/")[2] ?? "Root";
    result[module] ??= { upstream: 0, covered: 0 };
    result[module].upstream += 1;
    if (edgewarden.has(route)) result[module].covered += 1;
    return result;
  }, {}),
)
  .map(([module, counts]) => ({
    module,
    ...counts,
    coveragePercent: Number(
      ((counts.covered / counts.upstream) * 100).toFixed(1),
    ),
  }))
  .sort((left, right) => right.upstream - left.upstream);

if (json) {
  console.log(
    JSON.stringify(
      {
        summary: {
          sourceFilter: sourceFilter ?? null,
          upstream: upstream.size,
          covered: covered.length,
          missing: missing.length,
          coveragePercent: percentage,
          edgewardenOnly: additional.length,
        },
        modules,
        missing,
        edgewardenOnly: additional,
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `[routes] ${covered.length}/${upstream.size} upstream routes present (${percentage}%)`,
  );
  console.log(`[routes] ${additional.length} Edgewarden-only routes`);
  console.log("\nCoverage by upstream module:");
  for (const module of modules) {
    console.log(
      `  ${module.module.padEnd(18)} ${String(module.covered).padStart(3)}/${String(module.upstream).padEnd(3)} ${String(module.coveragePercent).padStart(5)}%`,
    );
  }
  if (missing.length && details) {
    console.log("\nMissing upstream routes:");
    for (const route of missing)
      console.log(`  ${route.route}  (${route.source})`);
  } else if (missing.length) {
    console.log(
      "\nRun with --details for missing routes, --json for machine-readable output,",
    );
    console.log("or --source Vault to restrict the official source tree.");
  }
}

if (failOnMissing && missing.length) process.exitCode = 1;
