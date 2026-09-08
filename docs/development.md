# Development workflow

Edgewarden uses `dev` for ongoing development and `main` for production-ready releases.

## Branch flow

1. Create feature or fix branches from `dev`.
2. Open pull requests back into `dev`.
3. Let CI run type, binding, migration, lint, test, production-build, and security checks.
4. Merge `dev` into `main` through a reviewed pull request when preparing a release.
5. Cloudflare Workers Builds deploys only the production branch, `main`.

Do not develop directly on `main`, rewrite published migration files, or bypass a failed required check. Configure branch protection for both branches:

- `dev`: require `Check, test, and build`, `Dependency audit`, and `Secret scan` before merge, and configure code scanning protection for CodeQL findings.
- `main`: require a pull request from `dev`, the same checks and code scanning protection, and no force pushes.

Cloudflare's production branch is configured in the dashboard rather than `wrangler.jsonc`. Set it to `main`. Non-production branch builds are optional; Edgewarden uses a Durable Object, so Cloudflare does not provide normal preview URLs for those builds.

## Local verification

Run the same gates before pushing:

```sh
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm check
pnpm lint:ci
pnpm test
pnpm build
```

`pnpm lint` still shows advisory warnings for cleanup work. CI uses `lint:ci` to reject correctness errors without flooding logs with existing warnings.

The scheduled Bitwarden domain-rule workflow commits generated changes to `dev`, never directly to production.

## Security checks

`security.yml` audits all workspace dependencies, including development dependencies, and scans Git history with Gitleaks. High and critical dependency advisories, detected secrets, and scanner failures fail their jobs. Gitleaks output is redacted; `.gitleaksignore` records only reviewed historical test-fixture fingerprints. Review each finding before adding an exception; do not exclude entire test directories.

`codeql.yml` analyzes JavaScript/TypeScript and GitHub Actions with the extended security queries. Findings appear in GitHub code scanning; a successful analysis job does not mean there are no findings. Configure repository rules to block merges on the chosen code scanning severity. Code scanning must be available and enabled for the repository; use this advanced workflow instead of a duplicate default CodeQL setup.

Both workflows run for pull requests into `dev` and `main`, pushes to those branches, weekly schedules, and manual dispatch. GitHub runs scheduled workflows on the default branch. New actions use full commit SHAs, and the Gitleaks binary uses a fixed version and SHA-256 checksum; update these pins when upgrading the tools.

## Dependency updates

Dependabot checks the pnpm workspace and GitHub Actions every Monday at 05:00 and 05:10 Asia/Shanghai respectively. Version-update pull requests target `dev`, with up to five open PRs per ecosystem. Minor and patch updates are grouped separately for production dependencies, development dependencies, and Actions; major updates remain individual PRs. Commits use Conventional Commits prefixes (`chore` or `ci`) with dependency scopes, matching cog's format.

Merge `.github/dependabot.yml` into the default branch to activate it. Dependabot security updates apply to the default branch independently of the `dev` version-update configuration; enable Dependabot alerts and security updates in the repository settings. The manually downloaded Gitleaks binary and its checksum still require manual updates.
