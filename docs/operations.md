# Operations

## Upgrading

1. Export an instance backup and verify its filename checksum in the backup center.
2. Read the release notes for new bindings or secrets.
3. Deploy normally. `pnpm deploy` resolves D1, applies pending migrations with Wrangler, and publishes only after they succeed. `deploy:kv` does the same with the KV configuration.
4. Run the compatibility smoke test and verify Web Vault login, sync, and attachment download.

After the first real deployment, never rewrite an applied migration. Add a new numbered migration, run `pnpm --filter @edgewarden/api db:codegen` to regenerate `apps/api/src/types/db.d.ts`, and test both a fresh schema and an upgrade from the preceding release.

## Backup and restore

R2 is the preferred blob backend. KV is a fallback with a 25 MiB per-object limit. Instance backups use a strict table allowlist and include users, encrypted vault data, organizations/collections, Sends, WebAuthn encrypted material, and optionally encrypted attachment blobs. They intentionally exclude JWT/data-encryption/bootstrap secrets, API keys, refresh tokens, device sessions, login-attempt records, audit logs, and transient locks.

Restore uses shadow tables and validates row counts before replacing live allowlisted tables. A restore invalidates persisted device and refresh sessions through user replacement. After restoring, verify:

- personal and organization cipher counts;
- collection membership and read-only/hide-password permissions;
- one attachment byte-for-byte;
- login with the restored master password;
- API key recreation if required.

Keep `DATA_ENCRYPTION_SECRET` separately: portable backup settings may require it, and losing it cannot be repaired from D1.

## Scheduled maintenance

Both deployment configurations install an hourly Cron Trigger at minute 17. The handler runs due backups and bounded cleanup: expired sessions, challenges and download tokens are removed; old login/auth-request records are pruned; expired invitations are closed; and deleted ciphers or expired Sends are removed together with their R2/KV objects. Each invocation processes at most 100 ciphers and 100 Sends so a large backlog is drained over subsequent runs without exceeding a Worker invocation.

## Troubleshooting

- `JWT_SECRET must be at least 32 characters`: configure an independent random Worker secret.
- Backup settings cannot decrypt: confirm the original `DATA_ENCRYPTION_SECRET` is configured.
- Attachments return 404 after switching storage: R2 and KV objects are not migrated automatically; switch back or restore a backup into the selected backend.
- Official client rejects login: run `pnpm test:compat:bw`, then inspect `/api/config`, `/identity/accounts/prelogin`, and the audit log.
- Domain recommendations are stale: run `pnpm domains:sync`; the scheduled workflow normally updates the generated upstream file weekly.
- A cipher update returns 409: sync first and reapply the edit; another client saved a newer revision.

Cloudflare-specific binding and production smoke verification remains a deployment-owner responsibility because it requires access to the target account.
