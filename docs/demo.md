# Read-only public Demo

The Demo lets visitors explore Edgewarden before self-hosting or contributing.
It is a real backend with public, synthetic encrypted data, not a password-storage
service. Never enter real passwords or reuse your real master password.

## Experience

- Public account: `demo@edgewarden.example`.
- Public password: `Edgewarden-Demo-2026!`.
- Log in through the Web Vault or set the Demo origin as an official Bitwarden
  client's self-hosted server, then use the same credentials.
- Explore login, TOTP, secure-note, card, identity, folder, organization collection
  and text Send examples. No attachment or file Send examples are provided yet.
- Registration, invitations, vault edits, uploads, security changes, device approval,
  API keys and administrative features are blocked by the server, even when a
  client displays their controls. This is not a full writable compatibility test.
- A small corner Demo button opens a dialog with credentials, server address,
  and self-host/contribution links. The login form prefills the public credentials
  only while untouched; it never submits automatically.
- Everyone shares public data. Other visitors' device lists and audit logs are
  unavailable. Do not enable push relay credentials on this public shared account.

## Isolation and deployment

Use `wrangler.demo.jsonc`, never production with an extra environment variable.
The separate entrypoint alone enables Demo policy.

| Resource | Demo name |
| --- | --- |
| Worker | `edgewarden-demo` |
| D1 | `edgewarden-demo-db` |
| R2 | `edgewarden-demo-attachments` |
| Durable Objects | Private to the Demo Worker |

Use independent secrets and a separate hostname. **Never bind production storage
or a production Durable Object namespace to this Worker.** Deployment validation
rejects shared resource names/IDs in repository configs. Runtime seeding refuses
an existing unmarked user database. Verify bindings in Cloudflare as well.
R2 remains present for compatibility with shared bindings, but Demo grants no
upload or deletion access and its scheduler never touches the bucket.

1. Run `pnpm build`.
2. Provision independent `JWT_SECRET`, `DATA_ENCRYPTION_SECRET`, and
   `BOOTSTRAP_SECRET` secrets for `edgewarden-demo`. Bootstrap is retained for
   shared deployment tooling but cannot create a Demo administrator.
3. Run `pnpm deploy:demo`. The script resolves/creates the separate D1 database,
   applies migrations and deploys; Wrangler provisions R2.
4. Set a separate custom domain in Cloudflare, or use workers.dev. A separate
   Workers Builds project should run `pnpm build` and `pnpm deploy:demo`.
5. Check `/api/demo` for `enabled: true`, `readOnly: true` and the public
   credentials. Log in and verify reading and write rejection before advertising.

The fixed fixture is seeded atomically on the first allowed API request.
There is **no daily vault reset**, open registration, or request-lease table.
The account is an ordinary user, not an administrator. Production keeps its
normal registration policy and returns `enabled: false` from `/api/demo`.

## Limits and cleanup

The explicit API allowlist fails closed for new routes, including GET endpoints
that could issue write capabilities. Login/refresh/revocation and read-related
POSTs (including the Send access-token grant) are allowed; unsupported grants are denied. Allowed request bodies are
limited to 32 KiB, including streamed bodies. Demo API traffic is rate-limited
per IP (120/minute); existing login rate limits also apply.

“Read-only” means immutable vault/account configuration, **not zero database
writes**: logins create sessions/devices, authentication creates security logs,
and receiving a Send increments its access counter. An hourly job expires
refresh sessions not refreshed in 24 hours and removes old unreferenced devices,
non-tombstone audit events and login-attempt records. It never deletes vault
items, users, organizations or files. Clients may need to log in again.
Normal production backup scheduling does not run in Demo.

Rate limits are approximate and **not a Cloudflare spending cap**. Rejected
requests, client polling and distributed abuse can still consume quotas.
Monitor Worker requests/CPU, D1 reads/writes and realtime usage; configure
Cloudflare alerts and abuse controls before publicizing. Disabling writes does
not guarantee a free public service under arbitrary traffic.

## Verification

- `pnpm --filter @edgewarden/api exec vitest run src/demo/demo.test.ts` checks
  seeding/isolation, route rejection, authenticated reads, refresh and cleanup.
- `pnpm test:compat:bw:demo` starts an isolated local Worker with temporary
  storage/secrets and runs the real CLI login, decryption, organization, Send,
  lock/unlock and write-rejection checks. Requires `bw` on PATH.
- The fixture generator is `scripts/generate-demo-fixture.ts`; its JSON output
  contains only public synthetic data. Regeneration is an intentional fixture
  change, not part of deployment. Existing seeded vaults are never overwritten.

The Web Vault reuses existing shadcn components; this mode adds no theme.
Mobile-client compatibility still needs device testing before launch.
