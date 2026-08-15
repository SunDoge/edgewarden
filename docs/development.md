# Development workflow

Edgewarden uses `dev` for ongoing development and `main` for production-ready releases.

## Branch flow

1. Create feature or fix branches from `dev`.
2. Open pull requests back into `dev`.
3. Let CI run type, binding, migration, lint, test, and production-build checks.
4. Merge `dev` into `main` through a reviewed pull request when preparing a release.
5. Cloudflare Workers Builds deploys only the production branch, `main`.

Do not develop directly on `main`, rewrite published migration files, or bypass a failed required check. Configure branch protection for both branches:

- `dev`: require the `Check, test, and build` status check before merge.
- `main`: require a pull request from `dev`, the same status check, and no force pushes.

Cloudflare's production branch is configured in the dashboard rather than `wrangler.jsonc`. Set it to `main`. Non-production branch builds are optional; Edgewarden uses a Durable Object, so Cloudflare does not provide normal preview URLs for those builds.

## Local verification

Run the same gates before pushing:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint:ci
pnpm test
pnpm build
```

`pnpm lint` still shows advisory warnings for cleanup work. CI uses `lint:ci` to reject correctness errors without flooding logs with existing warnings.

The scheduled Bitwarden domain-rule workflow commits generated changes to `dev`, never directly to production.
