# Edgewarden

Edgewarden is a Bitwarden-compatible password manager designed for Cloudflare Workers, D1, R2, and KV.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SunDoge/edgewarden)

## Deploy to Cloudflare

Click the button above, connect GitHub, and accept the detected build and deploy commands:

```text
Build command:  pnpm build
Deploy command: pnpm deploy
```

The deploy command resolves or creates the named D1 database, applies every pending migration with Wrangler, and only then publishes the Worker once. It uses a temporary ignored config for the account-specific D1 ID, so deployment never rewrites the portable repository config. Wrangler provisions the named R2 bucket during the final deployment.

Before the first build, select a custom API token under **Worker → Settings → Build → API token**. In addition to the normal Workers Builds permissions, it must grant **Account → D1 → Edit** for the target account. Cloudflare's automatically generated build token currently omits D1 access, while Edgewarden's deploy command must list/create the database and apply migrations. Keep the remaining generated-token permissions for Workers Scripts, R2 (or KV), account membership, and Workers Routes.

Configure these required secrets in the deployment form:

- `JWT_SECRET`: independently generated token-signing secret, at least 32 characters.
- `DATA_ENCRYPTION_SECRET`: independently generated persistent-data encryption secret, at least 32 characters. Back it up securely.
- `BOOTSTRAP_SECRET`: password required to create the first administrator account.

Generate independent random values locally with:

```sh
openssl rand -hex 32
```

To enable Turnstile for both login and registration, also configure the optional `TURNSTILE_SECRET_KEY` secret and the `TURNSTILE_SITE_KEY` Worker variable. Restrict the widget to the deployed hostname.

### Accounts without R2

R2 is the recommended storage backend for encrypted attachments and backup files. If the Cloudflare account cannot enable R2, select the same repository from Workers Builds and change only the deploy command to:

```text
pnpm deploy:kv
```

The KV deployment uses `wrangler.kv.jsonc`, resolves or creates both D1 and the named KV namespace, and never declares or provisions an R2 bucket. Account-specific IDs exist only in the temporary deployment config. KV limits each encrypted object to 25 MiB. Do not switch an existing deployment between R2 and KV without first migrating or backing up its stored objects.

## Manual deployment

The repository pins Node.js 26 and installs the latest pnpm release through `mise.toml`. For local development, install the toolchain and dependencies, create `.dev.vars` from `.dev.vars.example`, then run:

```sh
mise install
pnpm install --frozen-lockfile
pnpm build
pnpm deploy
```

Cloudflare Workers Builds does not need `mise`; the committed pnpm lockfile identifies the package manager.

Useful migration commands:

```sh
# Local D1 used by wrangler dev
pnpm db:migrate:local

# Bound production D1; safe to run repeatedly
pnpm db:migrate:remote
```

Normally `pnpm deploy` is sufficient. It stops before publishing if resource initialization or migration fails. The remote migration command remains available for operators who deliberately want to apply migrations separately; both paths use Wrangler's ordered `d1_migrations` ledger.

## Development and operations

```sh
pnpm check
pnpm test
pnpm test:compat:bw   # requires BW_SERVER, BW_EMAIL, BW_PASSWORD
pnpm domains:sync     # refresh generated Bitwarden global domain rules
```

The release number is shared by the API, Web Vault, and backup manifests through `packages/shared/version.ts`. Bitwarden's advertised compatibility version is deliberately separate because official clients use it for capability negotiation.

- [Client compatibility and test matrix](docs/compatibility.md)
- [Upgrade, restore, and troubleshooting guide](docs/operations.md)
- [Security boundaries](docs/security.md)
