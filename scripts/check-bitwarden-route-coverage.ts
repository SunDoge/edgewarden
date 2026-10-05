import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

interface Route {
  method: string;
  path: string;
  source: string;
  obsolete: boolean;
}

interface EdgewardenRouter {
  source: string;
  routes: Array<Pick<Route, "method" | "path">>;
  mounts: Array<{ prefix: string; child: string }>;
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
  const routers = new Map<string, EdgewardenRouter>();
  for (const file of walk(routeDirectory, ".ts")) {
    const source = readFileSync(file, "utf8");
    const declarations = [
      ...source.matchAll(
        /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Hono(?:<[^;]+?>)?\s*\(\s*\)/g,
      ),
    ];
    for (const [index, declaration] of declarations.entries()) {
      const name = declaration[1];
      if (routers.has(name))
        throw new Error(`Duplicate Hono router name: ${name}`);
      const start = declaration.index ?? 0;
      const end = declarations[index + 1]?.index ?? source.length;
      const chain = source.slice(start, end);
      routers.set(name, {
        source: relative(root, file),
        routes: [
          ...chain.matchAll(
            /\.(get|post|put|delete|patch)\(\s*["`]([^"`]+)["`]/g,
          ),
        ].map((match) => ({
          method: match[1].toUpperCase(),
          path: match[2],
        })),
        mounts: [
          ...chain.matchAll(
            /\.route\(\s*["`]([^"`]+)["`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g,
          ),
        ].map((match) => ({ prefix: match[1], child: match[2] })),
      });
    }
  }

  const mounted = new Set(
    [...routers.values()].flatMap((router) =>
      router.mounts.map((mount) => mount.child),
    ),
  );
  const joinPath = (prefix: string, path: string) =>
    `/${[prefix, path]
      .flatMap((part) => part.split("/"))
      .filter(Boolean)
      .join("/")}`;
  const flatten = (
    name: string,
    prefix: string,
    ancestors: Set<string>,
  ): Route[] => {
    const router = routers.get(name);
    if (!router) throw new Error(`Mounted Hono router not found: ${name}`);
    if (ancestors.has(name))
      throw new Error(`Cyclic Hono router mount: ${name}`);
    const nextAncestors = new Set(ancestors).add(name);
    return [
      ...router.routes.map((route) => ({
        ...route,
        path: joinPath(prefix, route.path),
        source: router.source,
        obsolete: false,
      })),
      ...router.mounts.flatMap((mount) =>
        flatten(mount.child, joinPath(prefix, mount.prefix), nextAncestors),
      ),
    ];
  };

  return [...routers.keys()]
    .filter((name) => !mounted.has(name))
    .flatMap((name) => flatten(name, "", new Set()));
}

function readControllerRoutes(
  serverRoot: string,
  sourceRoot: string,
  servicePrefix = "",
): Route[] {
  return walk(resolve(serverRoot, sourceRoot), ".cs").flatMap((file) => {
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
          /\[Http(Get|Post|Put|Delete|Patch)(?:\(\s*(?:"([^"]*)")?\s*\))?\]/g,
        ),
    ].flatMap((match) => {
      const matchIndex = classMatch.index + (match.index ?? 0);
      const methodDeclaration = source.indexOf("public ", matchIndex);
      const previousMethod = source.lastIndexOf("\n    public ", matchIndex);
      // Attributes for an action sit between the preceding declaration and
      // this method. Deprecated aliases remain discoverable without becoming
      // required compatibility targets.
      const attributeBlock = source.slice(
        Math.max(classMatch.index, previousMethod),
        methodDeclaration < 0 ? matchIndex : methodDeclaration,
      );
      // A verb without a template can be paired with separate Route
      // attributes. Only inspect this action's attributes, not the preceding
      // method body, which may contain unrelated attribute-like text.
      const previousBodyEnd = attributeBlock.lastIndexOf("\n    }");
      const actionAttributes = attributeBlock.slice(
        previousBodyEnd < 0 ? 0 : previousBodyEnd + "\n    }".length,
      );
      const separateRoutes = [
        ...actionAttributes.matchAll(/\[Route\(\s*"([^"]*)"\s*\)\]/g),
      ].map((route) => route[1]);
      const templates =
        match[2] !== undefined
          ? [match[2]]
          : separateRoutes.length
            ? separateRoutes
            : [""];
      return templates.map((suffix) => {
        // Absolute action templates override the controller prefix, but not
        // the separate service's deployment prefix (such as Identity).
        const controllerPath = /^(?:~\/|\/)/.test(suffix)
          ? suffix.replace(/^~?\//, "")
          : [prefix, suffix].filter(Boolean).join("/");
        const path = [servicePrefix, controllerPath].filter(Boolean).join("/");
        return {
          method: match[1].toUpperCase(),
          path,
          source: relative(serverRoot, file),
          obsolete: /\[Obsolete(?:Attribute)?(?:\(|\])/.test(attributeBlock),
        };
      });
    });
  });
}

function readBitwardenRoutes(serverRoot: string): Route[] {
  return [
    ...readControllerRoutes(serverRoot, "src/Api"),
    ...readControllerRoutes(serverRoot, "src/Identity/Controllers", "identity"),
  ];
}

function unique(routes: Route[]): Map<string, Route> {
  const result = new Map<string, Route>();
  for (const route of routes) result.set(key(route), route);
  return result;
}

// These aliases have already disappeared from the current server tree, or were
// Edgewarden-only actions previously placed in the Bitwarden namespace. An
// upstream `[Obsolete]` scan cannot identify either case. Keep the denylist
// narrow and pair every entry with the replacement Edgewarden implements.
const removedLegacyRoutes = new Map([
  ["POST /accounts/register", "POST /edgewarden/accounts/register"],
  ["POST /devices/delete", "POST /edgewarden/devices/delete"],
  ["DELETE /devices", "DELETE /edgewarden/devices"],
  ["PUT /devices/:parameter/name", "PUT /edgewarden/devices/:parameter/name"],
  ["POST /sends/delete", "POST /edgewarden/sends/delete"],
  [
    "GET /organizations/:parameter/invitee",
    "GET /edgewarden/organizations/:parameter/invitee",
  ],
  [
    "GET /organizations/:parameter/members",
    "GET /edgewarden/organizations/:parameter/members",
  ],
  [
    "POST /organizations/:parameter/members",
    "POST /edgewarden/organizations/:parameter/members",
  ],
  [
    "PUT /organizations/:parameter/members/:parameter",
    "PUT /edgewarden/organizations/:parameter/members/:parameter",
  ],
  [
    "DELETE /organizations/:parameter/members/:parameter",
    "DELETE /edgewarden/organizations/:parameter/members/:parameter",
  ],
  ["POST /identity/connect/revoke", "POST /identity/connect/revocation"],
  ["POST /sends/access/:parameter", "POST /sends/access"],
  [
    "POST /sends/:parameter/access/file/:parameter",
    "POST /sends/access/file/:parameter",
  ],
  ["GET /accounts/api-key", "POST /accounts/api-key"],
  ["DELETE /ciphers/:parameter/delete", "DELETE /ciphers/:parameter"],
  ["POST /ciphers/delete-permanent", "DELETE /ciphers"],
  ["POST /ciphers/restore", "PUT /ciphers/restore"],
  ["POST /ciphers/archive", "PUT /ciphers/archive"],
  ["POST /ciphers/unarchive", "PUT /ciphers/unarchive"],
  ["POST /ciphers/:parameter/archive", "PUT /ciphers/:parameter/archive"],
  ["POST /ciphers/:parameter/unarchive", "PUT /ciphers/:parameter/unarchive"],
  [
    "POST /sends/:parameter/remove-password",
    "PUT /sends/:parameter/remove-password",
  ],
  ["POST /sends/:parameter/remove-auth", "PUT /sends/:parameter/remove-auth"],
]);

// Upstream still marks this route obsolete while explicitly promising no EOL,
// and current native clients continue to call it. Keeping the exception here
// makes that compatibility debt visible instead of weakening the global gate.
const requiredCurrentClientCompatibility = new Map([
  [
    "POST /identity/accounts/prelogin",
    "Bitwarden iOS 2026.9 still uses it; upstream says the route has no EOL",
  ],
]);

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
const failOnObsolete = process.argv.includes("--fail-on-obsolete");
const failOnLegacy = process.argv.includes("--fail-on-legacy");
const includeObsolete = process.argv.includes("--include-obsolete");
const sourceArgument = process.argv.indexOf("--source");
const sourceFilter =
  sourceArgument >= 0 ? process.argv[sourceArgument + 1] : undefined;
if (sourceArgument >= 0 && !sourceFilter)
  throw new Error("--source requires a case-insensitive path fragment");
const allUpstreamRoutes = readBitwardenRoutes(serverRoot);
const allUpstream = unique(allUpstreamRoutes);
const currentUpstream = unique(
  allUpstreamRoutes.filter((route) => !route.obsolete),
);
const excludedObsolete = unique(
  allUpstreamRoutes.filter(
    (route) =>
      route.obsolete &&
      (!sourceFilter ||
        route.source.toLowerCase().includes(sourceFilter.toLowerCase())),
  ),
);
const upstream = unique(
  allUpstreamRoutes.filter(
    (route) =>
      (includeObsolete || !route.obsolete) &&
      (!sourceFilter ||
        route.source.toLowerCase().includes(sourceFilter.toLowerCase())),
  ),
);
const edgewarden = unique(readEdgewardenRoutes(projectRoot));
const implementedObsolete = [...excludedObsolete.entries()]
  .filter(
    ([route]) =>
      edgewarden.has(route) &&
      !currentUpstream.has(route) &&
      !requiredCurrentClientCompatibility.has(route),
  )
  .map(([route, details]) => ({
    route,
    source: details.source,
    edgewardenSource: edgewarden.get(route)?.source ?? "unknown",
  }))
  .sort((left, right) => left.route.localeCompare(right.route));
const implementedRequiredCompatibility = [
  ...requiredCurrentClientCompatibility.entries(),
]
  .filter(([route]) => edgewarden.has(route) && excludedObsolete.has(route))
  .map(([route, reason]) => ({
    route,
    reason,
    edgewardenSource: edgewarden.get(route)?.source ?? "unknown",
  }))
  .sort((left, right) => left.route.localeCompare(right.route));
const implementedRemovedLegacy = [...removedLegacyRoutes.entries()]
  .filter(([route]) => edgewarden.has(route))
  .map(([route, replacement]) => ({
    route,
    replacement,
    edgewardenSource: edgewarden.get(route)?.source ?? "unknown",
  }))
  .sort((left, right) => left.route.localeCompare(right.route));
const missingLegacyReplacements = [...removedLegacyRoutes.entries()]
  .filter(([, replacement]) => !edgewarden.has(replacement))
  .map(([route, replacement]) => ({ route, replacement }))
  .sort((left, right) => left.route.localeCompare(right.route));
const staleCompatibilityExceptions = [
  ...requiredCurrentClientCompatibility.entries(),
]
  .filter(([route]) => !excludedObsolete.has(route))
  .map(([route, reason]) => ({ route, reason }))
  .sort((left, right) => left.route.localeCompare(right.route));
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
    const sourceParts = details.source.split("/");
    const module =
      sourceParts[1] === "Api"
        ? (sourceParts[2] ?? "Api")
        : (sourceParts[1] ?? "Root");
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
          excludedObsolete: includeObsolete ? 0 : excludedObsolete.size,
          implementedObsolete: implementedObsolete.length,
          implementedRequiredCompatibility:
            implementedRequiredCompatibility.length,
          implementedRemovedLegacy: implementedRemovedLegacy.length,
          missingLegacyReplacements: missingLegacyReplacements.length,
          staleCompatibilityExceptions: staleCompatibilityExceptions.length,
        },
        modules,
        missing,
        implementedObsolete,
        implementedRequiredCompatibility,
        implementedRemovedLegacy,
        missingLegacyReplacements,
        staleCompatibilityExceptions,
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
  if (!includeObsolete)
    console.log(
      `[routes] ${excludedObsolete.size} obsolete upstream routes excluded`,
    );
  console.log(
    `[routes] ${implementedObsolete.length} obsolete-only upstream routes still implemented`,
  );
  console.log(
    `[routes] ${implementedRequiredCompatibility.length} current-client compatibility exceptions`,
  );
  console.log(
    `[routes] ${implementedRemovedLegacy.length} removed legacy routes still implemented`,
  );
  console.log(
    `[routes] ${missingLegacyReplacements.length} current replacements for denied legacy routes missing`,
  );
  console.log(
    `[routes] ${staleCompatibilityExceptions.length} stale current-client compatibility exceptions`,
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
  if (implementedObsolete.length && details) {
    console.log("\nImplemented obsolete-only routes:");
    for (const route of implementedObsolete)
      console.log(
        `  ${route.route}  (${route.edgewardenSource}; upstream ${route.source})`,
      );
  }
  if (implementedRequiredCompatibility.length && details) {
    console.log("\nCurrent-client compatibility exceptions:");
    for (const route of implementedRequiredCompatibility)
      console.log(`  ${route.route}  (${route.reason})`);
  }
  if (implementedRemovedLegacy.length && details) {
    console.log("\nImplemented removed legacy routes:");
    for (const route of implementedRemovedLegacy)
      console.log(
        `  ${route.route}  (${route.edgewardenSource}; use ${route.replacement})`,
      );
  }
  if (missingLegacyReplacements.length && details) {
    console.log("\nMissing current replacements for denied legacy routes:");
    for (const route of missingLegacyReplacements)
      console.log(`  ${route.replacement}  (replaces ${route.route})`);
  }
  if (staleCompatibilityExceptions.length && details) {
    console.log("\nStale current-client compatibility exceptions:");
    for (const route of staleCompatibilityExceptions)
      console.log(`  ${route.route}  (${route.reason})`);
  }
}

if (failOnMissing && missing.length) process.exitCode = 1;
if (failOnObsolete && implementedObsolete.length) process.exitCode = 1;
if (
  failOnLegacy &&
  (implementedRemovedLegacy.length ||
    missingLegacyReplacements.length ||
    staleCompatibilityExceptions.length)
)
  process.exitCode = 1;
