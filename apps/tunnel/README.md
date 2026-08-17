# Edgewarden Tunnel

This package is an independently deployed VLESS-over-WebSocket data plane for
Cloudflare Workers. It intentionally does not share the password manager's
Worker, D1 database, R2 bucket, secrets, routes, or deployment command.

Only VLESS TCP command `0x01` is supported. UDP and MUX are rejected. The
default destination allowlist contains TCP ports 80 and 443, and private,
loopback, link-local, documentation, multicast, and reserved destinations are
rejected before opening a socket.

## Local development

Create an ignored `apps/tunnel/.dev.vars` file:

```dotenv
VLESS_UUIDS=10982a88-05a9-4c5d-9142-0f618b07c94a
```

Then run:

```sh
pnpm --filter @edgewarden/tunnel dev
pnpm --filter @edgewarden/tunnel test
pnpm --filter @edgewarden/tunnel check
```

Binary WebSocket connections are accepted at `/ws`; `/healthz` provides a
non-sensitive health check. The first WebSocket frame must contain the complete
VLESS request header and should also carry the first application payload to
avoid an extra round trip.

## Deployment

Set the credential as a secret. Multiple UUIDs may be comma-separated during
the environment-only bootstrap phase:

```sh
cd apps/tunnel
pnpm exec wrangler secret put VLESS_UUIDS --env staging
pnpm exec wrangler secret put VLESS_UUIDS --env production
pnpm run deploy -- --env staging
pnpm run deploy -- --env production
```

Review `ALLOWED_PORTS`, frame limits, custom domains, and Cloudflare security
rules before production deployment. Do not expose a wildcard port policy
without an explicit abuse-control design.

`CONNECT_TIMEOUT_MS` bounds incomplete outbound connections. The frame and
pending-byte limits protect an isolate from slow upstreams; tune them together,
with the pending-byte limit at least as large as the largest accepted frame.

## Performance boundaries

- Policy is loaded once during the first frame, never per packet.
- Initial TCP payload uses a view over the WebSocket frame rather than copying.
- WebSocket-to-TCP writes are serialized and bounded to prevent concurrent
  writes or unbounded memory growth.
- TCP-to-WebSocket data remains binary; there is no Base64, JSON, or text
  conversion in the data path.
- Packet logging is intentionally absent. Errors contain request IDs but no
  credentials, hostnames, or payloads.

## Administration extension

`src/policy.ts` is the data-plane provider boundary and
`src/control-plane.ts` defines the versioned publication and usage-event
contracts. A future administration Worker should:

1. Store users, credential lifecycle, routes, quotas, and audit records in its
   own D1 database.
2. Validate a complete policy and publish an immutable, versioned projection to
   a dedicated KV namespace.
3. Add a `KvPolicyProvider` that reads that projection once per connection and
   compiles it to `TunnelPolicySnapshot`.
4. Send sampled connection events to Analytics Engine or Queues outside the
   forwarding loop. Never write a D1 row for every frame.
5. Keep emergency disable and credential rotation in the published projection;
   document KV propagation delay before treating revocation as instantaneous.

The environment provider remains a recovery path if the administration plane
is unavailable. A backend should preserve the schema version and revision in
all policy and usage records so migrations can be rolled out independently of
the tunnel Worker.
