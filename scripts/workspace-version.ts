import { globSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function validVersion(version: string): boolean {
  if (version.length > 128 || /\s/.test(version)) return false;
  const [release, build, ...extra] = version.split("+");
  if (extra.length) return false;
  const separator = release.indexOf("-");
  const core = separator < 0 ? release : release.slice(0, separator);
  const prerelease = separator < 0 ? undefined : release.slice(separator + 1);
  const numeric = (value: string) => /^(0|[1-9][0-9]*)$/.test(value);
  const identifiers = (value: string) =>
    value.split(".").every((part) => /^[0-9A-Za-z-]+$/.test(part));
  return (
    core.split(".").length === 3 &&
    core.split(".").every(numeric) &&
    (build === undefined || identifiers(build)) &&
    (prerelease === undefined ||
      (identifiers(prerelease) &&
        prerelease
          .split(".")
          .every((part) => !/^[0-9]+$/.test(part) || numeric(part))))
  );
}

/** Version all internal packages together; this repository does not publish npm packages. */
export function workspaceVersion(
  root: string,
  write = false,
  target?: string,
): string {
  // These directories match the package globs in pnpm-workspace.yaml.
  const paths = [
    "package.json",
    ...globSync(["apps/*/package.json", "packages/*/package.json"], {
      cwd: root,
    }).sort(),
  ];
  const manifests = paths.map((path) => {
    const value = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.name !== "string"
    ) {
      throw new Error(`${path}: expected a package object with a name`);
    }
    return { path, value };
  });
  const version = target ?? manifests[0].value.version;
  if (typeof version !== "string" || !validVersion(version)) {
    throw new Error(`Invalid application version: ${String(version)}`);
  }
  const runtimePath = "packages/shared/version.ts";
  const runtime =
    "/** Edgewarden release version shared by the API, Web Vault, and backups. */\n" +
    `export const EDGEWARDEN_VERSION = "${version}";\n`;
  // Read every managed file before making changes.
  const currentRuntime = readFileSync(resolve(root, runtimePath), "utf8");
  if (write) {
    for (const { path, value } of manifests) {
      value.version = version;
      value.private = true;
      writeFileSync(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`);
    }
    if (currentRuntime !== runtime)
      writeFileSync(resolve(root, runtimePath), runtime);
  } else {
    const errors: string[] = [];
    for (const { path, value } of manifests) {
      if (value.version !== version)
        errors.push(`${path}: version must be ${version}`);
      if (value.private !== true) errors.push(`${path}: private must be true`);
    }
    if (currentRuntime !== runtime)
      errors.push(`${runtimePath}: must match application version ${version}`);
    if (errors.length) throw new Error(errors.join("\n"));
  }
  return version;
}

if (import.meta.main) {
  try {
    const [mode, target, ...extra] = process.argv.slice(2);
    if (!["--check", "--write"].includes(mode) || extra.length) {
      throw new Error(
        "Usage: node scripts/workspace-version.ts --check|--write [version]",
      );
    }
    const root = resolve(import.meta.dirname, "..");
    const version = workspaceVersion(root, mode === "--write", target);
    if (mode === "--check" && process.env.GITHUB_REF_TYPE === "tag") {
      if (process.env.GITHUB_REF_NAME !== `v${version}`) {
        throw new Error(
          `Release tag must be v${version}, received ${process.env.GITHUB_REF_NAME}`,
        );
      }
    }
    console.log(
      `Workspace version ${version}: ${mode === "--write" ? "synchronized" : "valid"}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
