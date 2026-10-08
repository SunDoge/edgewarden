# Releasing Edgewarden

Edgewarden is one product, starting at **v0.1.0**. Only the root `package.json` has a version. Internal workspace packages are private and have no independent versions; the API, Web Vault, and backups read the root version through `packages/shared/version.ts`.

## Prepare a release

Release Please manages the root version, `CHANGELOG.md`, release tags, and GitHub Releases. Cog only validates Conventional Commit messages; do not run `cog bump`, `npm version`, or manually create release tags alongside this workflow.

Merge reviewed development changes from `dev` into `main`, preserving meaningful Conventional Commit messages. Release Please opens or updates a release PR against `main`. Fixes normally bump patch, features bump minor; breaking changes before 1.0 bump minor rather than automatically declaring 1.0. Documentation/CI-only changes may correctly produce no release PR.

Update `RELEASE_NOTES.md` with matching English and Chinese notes, upgrade impact, tested client versions, and known limitations. These curated acceptance notes remain separate from the generated changelog. Run normal CI and the [client acceptance matrix](compatibility.md) before merging the release PR. Review the generated version and notes; do not remove the automation labels or hand-edit the generated version.

## One-time credentials and baseline

No additional secret is required: the workflow uses the built-in `GITHUB_TOKEN`. Enable **Allow GitHub Actions to create and approve pull requests** under Settings → Actions → General. Keep required checks and approvals enabled.

PRs and tags created with this token do not automatically trigger other workflows. Manually run **CI**, **Security**, and **CodeQL** from Actions → the workflow → Run workflow, selecting the release PR's **head branch**, not `main`. Wait for all required checks on the latest PR commit before merging; repeat if the bot updates the PR. If a repository rule requires a PR-event analysis rather than a dispatched check, manually close and reopen the PR to trigger that event; do not bypass the rule.

After publication, manually run CI against the release tag to verify its version, for example `gh workflow run ci.yml --ref v0.1.1` (substitute the actual tag). See the [official authentication documentation](https://github.com/googleapis/release-please-action#other-actions-on-release-please-prs).

Optional: configure `RELEASE_PLEASE_TOKEN` with a repository-scoped PAT granting Contents, Pull requests, and Issues read/write to trigger these workflows automatically. Without it, the manual process above remains supported.

The manifest starts at the current `0.1.0` baseline; this does not create or claim an existing release. With no prior release tag, the first PR can include historical commits. Review the proposed version and notes. The manifest is automatically maintained after setup.

## Publish

Squash-merge the approved release PR into `main` using its generated Conventional Commit title. The next Release Please run creates the tag and GitHub Release. It does not automatically merge PRs or publish private packages to npm. The workflow runs on pushes to `main` or manual dispatch on `main`; dispatch retries processing but does not force a bump.

After release, open a `main` → `dev` synchronization PR and merge it preserving ancestry. Do not squash this synchronization or cherry-pick only the version: bring back the manifest and changelog as well.

CI checks that the tag matches the root version. Never move a published tag; subsequent fixes get a new version.

Application versions, Bitwarden compatibility versions, backup format versions, and database migration numbers remain independent. The old `1.0.0` application strings were development placeholders, not a published release.

This workflow contains no deployment steps or Cloudflare credentials. Cloudflare Workers Builds deploys `main` independently of GitHub Releases, including release PR merges if configured to do so. Tags are not a deployment gate. Back up the instance and follow [operations.md](operations.md) before merging deployment changes.
