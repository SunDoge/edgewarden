# Edgewarden

Edgewarden is a Bitwarden-compatible password manager designed for Cloudflare Workers, D1, R2, and KV.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SunDoge/edgewarden)

Current release line: **0.1.x**. See [release notes](RELEASE_NOTES.md), [contributing](CONTRIBUTING.md), and [private security reporting](SECURITY.md).

## Platform boundary

Edgewarden is intentionally Cloudflare-native. The complete server must run on Cloudflare Workers and bindings that Workers can access directly, such as D1, R2, KV and Durable Objects. A feature is implemented only when it can be made reliable and secure within Worker execution, networking, storage and scheduling constraints.

Optional outbound integrations, such as Bitwarden Push Relay, Turnstile, S3 and WebDAV, may be supported when they are usable directly from a Worker and do not require an Edgewarden companion server. Edgewarden will not add a required Node.js daemon, container, host filesystem, local SMTP server, LDAP connector or other always-on sidecar merely to imitate the official server. Features that require those facilities are documented as unsupported instead of being exposed as incomplete compatibility shims.

The precise personal, organization and platform-dependent feature boundary is maintained in [Supported product scope](docs/support-scope.md).

## Deploy to Cloudflare

The button above connects the repository to Cloudflare. The complete first-time
button flow on a fresh account has not yet been verified; do not assume a
zero-configuration deployment. Review the secrets and permissions below before
building. Use these build and deploy commands:

```text
Build command:  pnpm build
Deploy command: pnpm deploy
```

The deploy command resolves or creates the named D1 database, applies every pending migration with Wrangler, and only then publishes the Worker once. It uses a temporary ignored config for the account-specific D1 ID, so deployment never rewrites the portable repository config. Wrangler provisions the named R2 bucket during the final deployment.

Before the first build, select a custom API token under **Worker → Settings → Build → API token**. In addition to the normal Workers Builds permissions, it must grant **Account → D1 → Edit** for the target account. Cloudflare's automatically generated build token currently omits D1 access, while Edgewarden's deploy command must list/create the database and apply migrations. Keep the remaining generated-token permissions for Workers Scripts, R2 (or KV), account membership, and Workers Routes.

### Required runtime secrets

All three are required. Generate a **different value for each**; none is your
Cloudflare API token or your vault master password.

| Name | What to enter | Purpose and handling |
| --- | --- | --- |
| `JWT_SECRET` | A random string of at least 32 characters | Signs login and other short-lived tokens. Changing it invalidates tokens signed with the old value. |
| `DATA_ENCRYPTION_SECRET` | Another random string of at least 32 characters | Encrypts persisted server settings such as backup destination and Yubico credentials. Keep it stable and back it up separately; losing it makes those encrypted settings unreadable. It is not the key used to encrypt your vault items. |
| `BOOTSTRAP_SECRET` | A third independently generated random string | Enter this as the deployment password when registering the first administrator. Choose a separate master password for that account. This is not a recovery code or an existing user's login password. |

Run this command **three times**, and save each output under its corresponding
secret name in a secure password manager:

```sh
openssl rand -hex 32
```

Paste the generated value itself, without quotes or `NAME=`. Do not use example
values, reuse one value for all three, or commit secrets to the repository.

For a deployed Worker, set these under **Workers & Pages → your Worker → Settings
→ Variables and Secrets**, choosing **Secret** as the type. The deployment
form may also prompt for the three required secrets. Build-only environment
variables do not automatically become Worker runtime secrets. See
[Cloudflare's secrets guide](https://developers.cloudflare.com/workers/configuration/secrets/).

For local development, copy `.dev.vars.example` to `.dev.vars` and fill the three
values there. That file is local-only and does not configure production secrets.
Use different secrets for development, demo, and production.

### Optional integrations

You can leave **all of these unset** for an initial deployment. Omit unused
settings rather than entering placeholder credentials.

| Name | Type | When needed / what to enter |
| --- | --- | --- |
| `PUSH_INSTALLATION_ID` | Secret | Installation ID obtained from [Bitwarden](https://bitwarden.com/host/); configure together with the key below for native mobile push. |
| `PUSH_INSTALLATION_KEY` | Secret | Matching Bitwarden Installation Key, not a Cloudflare API token. Without this pair, Push Relay is disabled; manual sync remains available. |
| `PUSH_REGION` | Non-sensitive setting; store as Secret for Git deployments | `US` (default; may be omitted) or `EU`, matching the installation credentials. Storing it as a secret keeps it outside repository-managed variables. |
| `TURNSTILE_SECRET_KEY` | Secret | Server-side secret from your Cloudflare Turnstile widget. Configure together with its site key below, or leave both unset. |
| `TURNSTILE_SITE_KEY` | Variable (public) | The same widget's public site key. Restrict the widget to your deployed hostname. |
| `YUBICO_CLIENT_ID` | Secret | Yubico validation client ID; only for YubiKey OTP validation, not ordinary WebAuthn security keys. Configure with the key below. |
| `YUBICO_SECRET_KEY` | Secret | Matching Yubico validation secret. These two settings override credentials configured through the administration UI. |

Turnstile protection is enabled when its secret is present, so do not configure
the secret without the matching public site key.

### Ordinary variables and deployment credentials

The repository defaults to `SIGNUPS_ALLOWED="false"` and
`INVITATIONS_ALLOWED="true"`: after the first administrator, registration
requires an invitation. The bootstrap secret is still required for the first
account. `ATTACHMENT_STORAGE="r2"` is the default; use `pnpm deploy:kv` below
instead of changing only this variable when deploying without R2.

Keep ordinary variable changes in your deployment's Wrangler configuration so
later Git deployments use the same values. Advanced CORS and WebAuthn variables
are listed in [optional Worker configuration](apps/api/README.md#optional-worker-configuration);
most deployments should leave them unset. Do not set the legacy `ADMIN_PASSWORD`
alias for a new deployment.

The **Cloudflare deployment API token** is separate from all application secrets.
It authorizes the build/deploy process to manage your Cloudflare resources; it is
not a vault credential and should not be added as an application runtime secret.
Configure it under Workers Builds as described above. See
[Cloudflare's build configuration guide](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

After deploying, open the web vault and register the first account using your
`BOOTSTRAP_SECRET` as the deployment password. Confirm login and sync before
adding optional integrations. Push Relay configuration status is visible in the
administration page; successful deployment alone does not prove push delivery.

Optional deployment settings are documented in [apps/api/README.md](apps/api/README.md#optional-worker-configuration). Most deployments should leave the WebAuthn RP settings unset so passkeys derive the RP ID and origin from the request hostname.

### Accounts without R2

R2 is the recommended storage backend for encrypted attachments and backup files. If the Cloudflare account cannot enable R2, select the same repository from Workers Builds and change only the deploy command to:

```text
pnpm deploy:kv
```

The KV deployment derives a temporary KV variant from `wrangler.jsonc`, resolves or creates both D1 and the named KV namespace, and never declares or provisions an R2 bucket. Account-specific IDs exist only in the temporary deployment config. KV limits each encrypted object to 25 MiB. Do not switch an existing deployment between R2 and KV without first migrating or backing up its stored objects.

On an R2 deployment, the backup center can use the existing `ATTACHMENTS_R2` binding directly. Native backups are stored under the reserved `backups/` prefix; no additional bucket or R2 API credentials are required. See [Backup and restore](docs/operations.md#backup-and-restore) for the archive layout and isolation tradeoffs.

## Manual deployment

The repository selects Node.js 26 and a pnpm launcher through `mise.toml`; `package.json` pins the pnpm version used by the workspace. For local development, install the toolchain and dependencies, create `.dev.vars` from `.dev.vars.example`, then run:

```sh
mise install
pnpm install --frozen-lockfile
pnpm build
pnpm deploy
```

Cloudflare Workers Builds does not need `mise`; the committed pnpm lockfile identifies the package manager.

Useful migration commands:

```sh
# Local D1 used by wrangler dev (also runs automatically before `pnpm dev`)
pnpm db:migrate:local

# Bound production D1; safe to run repeatedly
pnpm db:migrate:remote
```

Normally `pnpm deploy` is sufficient. It stops before publishing if resource initialization or migration fails. The remote migration command remains available for operators who deliberately want to apply migrations separately; both paths use Wrangler's ordered `d1_migrations` ledger.

## Development and operations

Want to offer a read-only trial server with public synthetic data for potential users and
contributors? See [Public Demo deployment](docs/demo.md). It uses a separate
Worker, D1 database, and R2 bucket; never point it at production storage.

```sh
pnpm check
pnpm test
pnpm test:compat:bw:local # isolated local Worker and disposable account
pnpm test:compat:bw   # requires BW_SERVER, BW_EMAIL, BW_PASSWORD
pnpm domains:sync     # refresh generated Bitwarden global domain rules
```

For local UI work, you can keep using the real authentication flow without
re-entering credentials on every restart. Register the local account once,
copy `apps/web/.env.example` to `apps/web/.env.local`, set
`VITE_DEV_AUTO_LOGIN=true`, and fill in `VITE_DEV_EMAIL` and
`VITE_DEV_PASSWORD`. Auto-login only runs under Vite's development mode and is
disabled when Turnstile is enabled; `.env.local` is ignored by Git.

The release number is shared by the API, Web Vault, and backup manifests through `packages/shared/version.ts`. Bitwarden's advertised compatibility version is deliberately separate because official clients use it for capability negotiation.

- [Client compatibility and test matrix](docs/compatibility.md)
- [Testing guide and reusable helpers](docs/testing.md)
- [Development branches and CI workflow](docs/development.md)
- [Supported product scope](docs/support-scope.md)
- [Upgrade, restore, and troubleshooting guide](docs/operations.md)
- [Security boundaries](docs/security.md)
- [Release checklist](docs/releasing.md)
