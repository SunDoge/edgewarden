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

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```
# Turnstile login protection

Password login supports optional Cloudflare Turnstile verification. Configure both values in the Worker environment:

```sh
wrangler secret put TURNSTILE_SECRET_KEY
```

Set `TURNSTILE_SITE_KEY` as a Worker variable in Cloudflare. Turnstile is enforced only when `TURNSTILE_SECRET_KEY` is present; when enabled, the public site key is returned by `/api/config`. Restrict the production widget to the deployed hostname. For local testing, use Cloudflare's documented Turnstile test keys rather than production keys.
