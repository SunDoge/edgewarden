import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { workspaceVersion } from "./workspace-version.ts";

function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "edgewarden-version-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, value] of Object.entries({
    "package.json": { name: "edgewarden", version: "0.1.0", private: true },
    "apps/api/package.json": {
      name: "@edgewarden/api",
      dependencies: { "@edgewarden/shared": "workspace:*" },
    },
    "apps/web/package.json": {
      name: "@edgewarden/web",
      version: "0.0.1",
      private: true,
    },
    "packages/shared/package.json": {
      name: "@edgewarden/shared",
      version: "1.0.0",
      private: true,
    },
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  }
  writeFileSync(
    join(root, "packages/shared/version.ts"),
    'export const EDGEWARDEN_VERSION = "1.0.0";\n',
  );
  return root;
}

const read = (root: string, path: string) =>
  readFileSync(join(root, path), "utf8");

test("synchronizes private packages from the root and preserves internal dependencies", (t) => {
  const root = fixture(t);
  assert.equal(workspaceVersion(root, true), "0.1.0");
  assert.equal(workspaceVersion(root), "0.1.0");
  assert.deepEqual(JSON.parse(read(root, "apps/api/package.json")), {
    name: "@edgewarden/api",
    dependencies: { "@edgewarden/shared": "workspace:*" },
    version: "0.1.0",
    private: true,
  });
  const before = read(root, "apps/api/package.json");
  workspaceVersion(root, true);
  assert.equal(read(root, "apps/api/package.json"), before);
});

test("checks report version and publishing drift without changing files", (t) => {
  const root = fixture(t);
  const before = read(root, "apps/api/package.json");
  assert.throws(
    () => workspaceVersion(root),
    /apps\/api\/package.json: private must be true/,
  );
  assert.equal(read(root, "apps/api/package.json"), before);
  workspaceVersion(root, true);
  assert.throws(
    () => workspaceVersion(root, false, "0.2.0"),
    /version must be 0.2.0/,
  );
  assert.equal(JSON.parse(read(root, "package.json")).version, "0.1.0");
  writeFileSync(
    join(root, "packages/shared/version.ts"),
    "// stale runtime version\n",
  );
  assert.throws(() => workspaceVersion(root), /must match application version/);
});

test("discovers newly added workspace packages", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "packages/new-package"));
  writeFileSync(
    join(root, "packages/new-package/package.json"),
    '{"name":"new-package"}',
  );
  workspaceVersion(root, true, "0.2.0");
  assert.equal(workspaceVersion(root), "0.2.0");
  assert.deepEqual(
    JSON.parse(read(root, "packages/new-package/package.json")),
    {
      name: "new-package",
      version: "0.2.0",
      private: true,
    },
  );
});

test("rejects invalid SemVer before modifying any files", (t) => {
  const root = fixture(t);
  const before = read(root, "package.json");
  for (const version of [
    "",
    "v0.1.0",
    "1.2",
    "01.2.3",
    "1.2.3-01",
    "1.2.3-",
    "1.2.3+",
    "1.2.3+a+b",
    "1.2.3\n",
  ]) {
    assert.throws(
      () => workspaceVersion(root, true, version),
      /Invalid application version/,
    );
    assert.equal(read(root, "package.json"), before);
  }
});

test("accepts stable, prerelease, and build metadata versions", (t) => {
  const root = fixture(t);
  for (const version of [
    "0.1.1",
    "0.2.0-beta.1",
    "1.0.0-0",
    "1.0.0-beta.01a+build.001",
  ]) {
    workspaceVersion(root, true, version);
    assert.equal(workspaceVersion(root), version);
  }
});

test("malformed package metadata prevents partial synchronization", (t) => {
  const root = fixture(t);
  const before = read(root, "package.json");
  writeFileSync(join(root, "apps/web/package.json"), "{");
  assert.throws(() => workspaceVersion(root, true, "0.2.0"), SyntaxError);
  assert.equal(read(root, "package.json"), before);
  for (const invalid of ["null", "[]", "{}"]) {
    writeFileSync(join(root, "apps/web/package.json"), invalid);
    assert.throws(
      () => workspaceVersion(root, true, "0.2.0"),
      /expected a package object/,
    );
    assert.equal(read(root, "package.json"), before);
  }
});

test("the CLI rejects mismatched release tags and invalid arguments", (t) => {
  const root = fixture(t);
  workspaceVersion(root, true);
  mkdirSync(join(root, "scripts"));
  copyFileSync(
    new URL("./workspace-version.ts", import.meta.url),
    join(root, "scripts/workspace-version.ts"),
  );
  const run = (args: string[], tag: string) =>
    spawnSync(
      process.execPath,
      [join(root, "scripts/workspace-version.ts"), ...args],
      {
        encoding: "utf8",
        env: { ...process.env, GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: tag },
      },
    );
  assert.equal(run(["--check"], "v0.1.0").status, 0);
  const mismatch = run(["--check"], "v0.2.0");
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /Release tag must be v0.1.0/);
  assert.equal(run(["--unknown"], "v0.1.0").status, 1);
});
