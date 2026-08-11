# Edgewarden

Edgewarden is a Bitwarden-compatible password manager designed for Cloudflare Workers, D1, R2, and KV.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SunDoge/edgewarden)

## Deploy to Cloudflare

Click the button above, connect GitHub, and accept the detected build and deploy commands:

```text
Build command:  bun run build
Deploy command: bun run deploy
```

Cloudflare automatically provisions and binds the required D1 database, R2 bucket, and KV namespace. The deploy command applies every pending D1 migration through the `DB` binding before publishing the Worker.

Configure these required secrets in the deployment form:

- `JWT_SECRET`: independently generated token-signing secret, at least 32 characters.
- `DATA_ENCRYPTION_SECRET`: independently generated persistent-data encryption secret, at least 32 characters. Back it up securely.
- `BOOTSTRAP_SECRET`: password required to create the first administrator account.

Generate independent random values locally with:

```sh
openssl rand -hex 32
```

To enable Turnstile for both login and registration, also configure the optional `TURNSTILE_SECRET_KEY` secret and the `TURNSTILE_SITE_KEY` Worker variable. Restrict the widget to the deployed hostname.

## Manual deployment

Install dependencies, create `.dev.vars` from `.dev.vars.example`, then run:

```sh
bun install
bun run build
bun run deploy
```

Useful migration commands:

```sh
# Local D1 used by wrangler dev
bun run db:migrate:local

# Bound production D1; safe to run repeatedly
bun run db:migrate:remote
```

`bun run deploy` intentionally runs the remote migration command before `wrangler deploy`. Applied migrations are tracked by D1 and are not executed again.
