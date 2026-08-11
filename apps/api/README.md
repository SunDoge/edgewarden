```txt
npm install
npm run dev
```

```txt
npm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

# Registration policy

The first account is always the administrator and requires a deployment secret:

```sh
wrangler secret put BOOTSTRAP_SECRET
```

`BOOTSTRAP_SECRET` is compared in constant time, is never stored in D1, and is
never returned by `/api/config`. Use a unique, randomly generated secret.

`ADMIN_PASSWORD` remains accepted as a compatibility alias for existing
deployments. New deployments should use `BOOTSTRAP_SECRET`.

`SIGNUPS_ALLOWED` controls registration without an invite and defaults to
`false`. `INVITATIONS_ALLOWED` controls registration with an active, unexpired
one-time invite and defaults to `true`. Set both as Worker variables. Neither
setting bypasses the deployment password required to create the first account.

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

# Blob storage

R2 is the default backend for encrypted attachments and attachment-inclusive
backups. Set `ATTACHMENT_STORAGE` to `r2` and bind `ATTACHMENTS_R2`.

For accounts that cannot enable R2, bind `ATTACHMENTS_KV` and set
`ATTACHMENT_STORAGE` to `kv`. KV remains a compatibility backend and limits each
object to 25 MiB. When both bindings exist, reads fall back to the other backend
to support migrations, while new writes follow `ATTACHMENT_STORAGE` (R2 by
default) and deletes remove both copies.

# Observability

Workers Logs is enabled in `wrangler.jsonc` with 10% head sampling. Invocation
logs are operational diagnostics only. Security audit events remain in D1. Do
not add email addresses, credentials, tokens, vault ciphertext, or raw request
bodies to `console` output.

# D1 point-in-time recovery

D1 Time Travel is always enabled for production D1 databases. The Workers Free
plan retains seven days of history. Before a risky migration, record the current
bookmark:

```sh
wrangler d1 time-travel info edgewarden-db
```

To inspect the bookmark for a UTC/RFC3339 timestamp:

```sh
wrangler d1 time-travel info edgewarden-db \
  --timestamp="2026-08-11T05:00:00Z"
```

Restoring overwrites the production database and cancels in-flight queries.
Stop application writes, record the current bookmark so the restore can be
undone, verify the target timestamp, and then run one of:

```sh
wrangler d1 time-travel restore edgewarden-db --bookmark=BOOKMARK
wrangler d1 time-travel restore edgewarden-db --timestamp=UNIX_TIMESTAMP
```

Afterward, verify user, cipher, attachment metadata, and audit-log counts before
resuming writes. Time Travel covers D1 only; restore R2/KV objects from an
attachment-inclusive Edgewarden backup when blob data also needs recovery.

# Turnstile login protection

Password login supports optional Cloudflare Turnstile verification. Configure both values in the Worker environment:

```sh
wrangler secret put TURNSTILE_SECRET_KEY
```

Set `TURNSTILE_SITE_KEY` as a Worker variable in Cloudflare. Turnstile is enforced only when `TURNSTILE_SECRET_KEY` is present; when enabled, the public site key is returned by `/api/config`. Restrict the production widget to the deployed hostname. For local testing, use Cloudflare's documented Turnstile test keys rather than production keys.
