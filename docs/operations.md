# Operations

## Upgrading

1. Export an instance backup and verify its filename checksum in the backup center.
2. Read the release notes for new bindings or secrets.
3. Set `EDGEWARDEN_HEALTH_URL` to the public instance origin in the Cloudflare build variables (for example, `https://edgewarden.example.com`).
4. Deploy normally. `pnpm deploy` resolves D1, validates the exact generated Wrangler configuration with a dry run, applies pending migrations, publishes only after they succeed, and waits for `/api/health` to report ready. `deploy:kv` does the same with the KV configuration. The health probe checks required secrets, the selected attachment backend, D1, and the newest schema contract. It retries briefly for edge propagation and fails the deployment command if the new release never becomes healthy.
5. Run the compatibility smoke test and verify Web Vault login, sync, and attachment download.

After the first real deployment, never rewrite an applied migration. Add a new numbered migration, run `pnpm --filter @edgewarden/api db:codegen` to regenerate `apps/api/src/types/db.d.ts`, and test both a fresh schema and an upgrade from the preceding release.

Migrations run before the new Worker becomes active, so every migration must remain compatible with the currently deployed Worker. Use expand/backfill/contract across releases instead of dropping or renaming a live column in one release. `pnpm check` enforces ordered migration filenames and rejects common destructive SQL operations. Wrangler rolls back the failing migration itself and D1 Time Travel remains available for operator recovery, but neither replaces an application backup before a risky upgrade.

## Backup and restore

R2 is the preferred blob backend. KV is a fallback with a 25 MiB per-object limit. Instance backups use a strict table allowlist and include users, encrypted vault data, organizations/collections, Sends, WebAuthn encrypted material, and optionally encrypted attachment blobs. They intentionally exclude JWT/data-encryption/bootstrap secrets, API keys, refresh tokens, device sessions, login-attempt records, audit logs, and transient locks.

Restore uses shadow tables and validates row counts before replacing live allowlisted tables. Attachment files are staged under immutable object keys, then their D1 references switch atomically with the restored tables; a failed restore leaves the previous database and its files intact. A restore invalidates persisted device and refresh sessions through user replacement. After restoring, verify:

Old or failed-staging object keys are inserted into `blob_gc_queue` in the same D1 transaction as the shadow-table switch. Cleanup checks that a key is no longer referenced before deletion and retries R2/KV failures with bounded exponential backoff during hourly maintenance. The queue contains only opaque object keys and retry state, not decrypted metadata or vault contents.

- personal and organization cipher counts;
- collection membership and read-only/hide-password permissions;
- one attachment byte-for-byte;
- login with the restored master password;
- API key recreation if required.

Keep `DATA_ENCRYPTION_SECRET` separately: portable backup settings may require it, and losing it cannot be repaired from D1.

## Scheduled maintenance

Both deployment configurations install an hourly Cron Trigger at minute 17. The handler runs due backups and bounded housekeeping: expired sessions, challenges and download tokens are removed; old login/auth-request records are pruned; expired invitations are closed; and orphaned unpublished, replaced, or failed-restore blobs are retried from the GC queue. User-facing deletion creates a D1 tombstone and immediately hides the entity from normal API and sync results. Account deletion also bans login and revokes refresh tokens immediately; organization deletion immediately hides membership and vault access. Scheduled housekeeping never physically deletes a published vault entity or its blob.

Audit events are append-only through the API and are retained permanently by default; there is no bulk-clear endpoint. An operator may explicitly configure finite retention for privacy or D1 capacity requirements. Logically deleted vault rows and their published attachment/Send blobs are retained as encrypted source material for audit and disaster recovery. Scheduled maintenance only removes ephemeral authentication state and orphaned unpublished or replaced blobs; it never physically purges a published vault entity.

Every Cron invocation emits a structured `scheduled.completed` log containing duration, per-destination backup totals, GC counts, and an error count. Individual backup destinations emit `backup.scheduled.failed`; configuration/decryption failures emit `backup.scheduled.error`. Backup and maintenance failures are isolated so maintenance still runs when backup configuration is broken, but the Scheduled event is marked failed so Cloudflare notification or log-based alerts can detect it.

## Troubleshooting

- `JWT_SECRET must be at least 32 characters`: configure an independent random Worker secret.
- Backup settings cannot decrypt: confirm the original `DATA_ENCRYPTION_SECRET` is configured.
- Cron reports `backup.scheduled.error`: do not ignore it as “no backup configured”; open the backup center and reactivate or repair the encrypted destination settings.
- Attachments return 404 after switching storage: R2 and KV objects are not migrated automatically; switch back or restore a backup into the selected backend.
- Official client rejects login: run `pnpm test:compat:bw`, then inspect `/api/config`, `/identity/accounts/prelogin`, and the audit log.
- Domain recommendations are stale: run `pnpm domains:sync`; the scheduled workflow normally updates the generated upstream file weekly.
- A cipher update returns 409: sync first and reapply the edit; another client saved a newer revision.

Cloudflare-specific binding and production smoke verification remains a deployment-owner responsibility because it requires access to the target account.
