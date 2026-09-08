# Releasing Edgewarden

Public releases start at **v0.1.0**. The earlier `1.0.0` strings were development placeholders, not a published stability promise. Before 1.0, minor releases may change behavior; document compatibility and migration impacts explicitly.

## Prepare

1. Create a release branch and run `pnpm version:sync 0.1.0` (substitute the intended version). This updates the root manifest, all packages under `apps/*` and `packages/*`, and the runtime version in `packages/shared/version.ts`. Without an argument, `pnpm version:sync` uses the root `package.json` version. Do not change the Bitwarden compatibility version, backup format version, or historical migrations just to match a release number.
2. Write matching English and Chinese entries in `RELEASE_NOTES.md`, including known limitations and the actual versions of tested clients. Describe upgrade impact rather than pasting a commit list.
3. Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm lint:ci`, `pnpm test`, `pnpm build`, `pnpm audit`, and `pnpm test:compat:bw:local`. Validate the workflows and review CodeQL findings.
4. Complete the staging acceptance matrix in [compatibility.md](compatibility.md), including deployed Cloudflare bindings and backup/restore. A local CLI pass does not verify Android, iOS, desktop, or browser-extension behavior. Record untested clients explicitly.
5. Commit with `cog commit chore "prepare v0.1.0 release" release` (substitute the intended version). Open a reviewed release pull request and wait for CI. Ensure the intended changes reach `main` before creating a public tag.

## Publish

A GitHub draft is reviewable preparation, not a published release or a completed acceptance test. Keep it as a draft while checks or staging acceptance are outstanding.

After the release commit is merged, fetch and fast-forward a clean `main` checkout. Confirm all version files and release notes correspond to that commit. Create the version tag with cog, then publish the reviewed GitHub release against that existing tag:

```sh
cog bump --version 0.1.0 --disable-bump-commit --hook-profile publish
git show --no-patch v0.1.0
git push origin v0.1.0
```

The release preparation commit already contains the curated notes and version changes. The `publish` profile only checks that every version equals the target and all packages are private; `--disable-bump-commit` leaves the reviewed commit unchanged. Always use this profile with tag-only publication. Never move a published tag to different code. Subsequent fixes receive a new version.

Cloudflare Workers Builds deploys `main` independently of GitHub Release publication. Before merging a release, review database migrations, back up the instance, and follow [operations.md](operations.md). Publishing a release does not itself test or deploy a Worker.

## Workspace version policy

Edgewarden is released as one product and does not publish npm packages. The root `package.json` is the application version source. Every package in `apps/*` and `packages/*` must have the same version and `private: true`; internal dependencies retain `workspace:*`. Update the discovery globs in `scripts/workspace-version.ts` if the workspace layout changes.

`pnpm version:check` is read-only and runs as part of `pnpm check` in CI. It rejects package-version drift, missing private flags, stale runtime versions, and a `v*` GitHub tag that differs from the application version. `pnpm test:version` exercises synchronization and failure cases and is included in `pnpm test`.

The default cog pre-bump hooks synchronize and check the selected version. On a clean local branch, `cog bump --version 0.2.0` therefore creates a version commit and one local `v0.2.0` tag. It does not push or publish anything. The reviewed release-PR workflow above uses `version:sync` during preparation and the read-only `publish` profile after merge so that the public tag points to the reviewed `main` commit.

Cog's per-package versioning is not enabled. Automatic changelog generation is disabled because `RELEASE_NOTES.md` contains curated bilingual notes. Neither cog nor the synchronization script changes dependency ranges, migration numbers, backup format versions, or the advertised Bitwarden protocol version.
