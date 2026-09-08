# Releasing Edgewarden

Edgewarden is one product, starting at **v0.1.0**. Only the root `package.json` has a version. Internal workspace packages are private and have no independent versions; the API, Web Vault, and backups read the root version through `packages/shared/version.ts`.

## Prepare a release

Update `RELEASE_NOTES.md` with matching English and Chinese notes, upgrade impact, tested client versions, and known limitations. Commit the notes with cog, then run on a clean release branch:

```sh
cog bump --version 0.1.0
```

Cog runs `npm version` to update the root version field, then creates a local release commit and `v0.1.0` tag. It does not publish npm packages. For subsequent releases, use the intended version, such as `0.1.1`.

Run the normal CI checks and the [client acceptance matrix](compatibility.md). Open a release PR and wait for checks and review. Keep the GitHub Release as a draft while acceptance is outstanding.

## Publish

Merge the release PR into `main` while preserving its release commit (use a merge commit, not squash). Confirm the local tag points to that reviewed commit, then push the tag and publish the GitHub draft against it:

```sh
git push origin v0.1.0
```

CI checks that the tag matches the root version. Never move a published tag; subsequent fixes get a new version.

Application versions, Bitwarden compatibility versions, backup format versions, and database migration numbers remain independent. The old `1.0.0` application strings were development placeholders, not a published release.

Cloudflare Workers Builds deploys `main` independently of GitHub Releases. Back up the instance and follow [operations.md](operations.md) before merging deployment changes.
