# Contributing

Start with the [development workflow](docs/development.md), [testing guide](docs/testing.md), and [supported scope](docs/support-scope.md). Create changes from `dev` and open pull requests against `dev`.

Keep changes focused, describe the user-visible behavior, and run the relevant checks. Bitwarden protocol changes should include compatibility coverage. Schema changes require a new migration; never rewrite a published migration.

Stage only the intended files and create a Conventional Commit with cog:

```sh
git add path/to/changed-file
cog commit fix "describe the corrected behavior" api
```

Use `cog verify 'fix(api): describe the corrected behavior'` to check a proposed commit or PR title. Install the configured commit-message hook with `cog install-hook commit-msg`.

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
