# Client compatibility

Edgewarden implements the Bitwarden password-manager protocol; it is not a drop-in implementation of every Bitwarden product. Personal password-manager functionality is the complete compatibility target, while organizations intentionally support basic encrypted sharing rather than enterprise parity. See the [support scope](support-scope.md) for the normative product boundary.

Bitwarden password-protected and unencrypted JSON imports preserve stored website passkeys in `login.fido2Credentials` and encrypt every credential field locally before upload. Password-protected files are decrypted only in browser memory and support both PBKDF2-SHA256 and Argon2id export parameters. Account-restricted exports cannot be moved to another server by design. Passkeys used to sign in to a Bitwarden account are RP-bound account credentials rather than vault items; create new account-login passkeys for the Edgewarden hostname after migration.

Cipher payloads preserve unknown top-level and type-specific fields. Mutations carrying `lastKnownRevisionDate` use optimistic concurrency control and return HTTP 409 instead of overwriting a newer revision.

## Automated CLI smoke test

Install the official `bw` binary with mise (`mise install`), point the test at a disposable account, and run:

```sh
BW_SERVER=https://edgewarden.example.com \
BW_EMAIL=compat@example.com \
BW_PASSWORD='disposable-password' \
pnpm test:compat:bw
```

The TypeScript test uses isolated temporary CLI profiles and covers password login, lock/unlock, repeated and bidirectional sync, folder CRUD, all four personal item types, TOTP and custom fields, archive/trash/restore, attachment upload/download/deletion, and password-protected text and file Sends. A second fresh profile verifies both directions of cloud synchronization instead of trusting one client's cache. Every CLI operation has a timeout, resources are registered for cleanup as soon as they are created, and the test deletes them in a `finally` block. Never target an important account.

## Release acceptance matrix

Run these checks against staging before publishing a release:

| Client | Required checks |
| --- | --- |
| `bw` CLI | Run the automated smoke test above |
| Browser extension | Password login, unlock, sync, create/edit/delete, autofill, attachment |
| Desktop | Password login, lock/unlock, sync, attachment, TOTP |
| Android | Password login, sync, attachment download, SSH-key item, 2FA and recovery |
| iOS | Password login, sync, attachment download, passkey/2FA |
| Edgewarden Web | Offline unlock, reconnect sync, stale-edit conflict, import/export, QR TOTP |

For mobile clients, also confirm `email_verified`, `amr`, user-decryption options, attachment URLs, and recovery-provider responses remain accepted. Record the tested client versions in the release notes.

## Native Rust SDK check (Plico / Warden)

The pinned Bitwarden Rust SDK accepts PascalCase names as Serde aliases, but
rejects a response containing both an alias and its canonical camelCase field.
Sync therefore emits only `userDecryption` and `userDecryptionOptions`; account
keys emit only `object`, including nested key-pair discriminators. The token
endpoint retains its separate SDK decryption-options contract. Distinct protocol
fields such as `masterKeyWrappedUserKey` and `masterKeyEncryptedUserKey` remain.

Build the sibling Warden probe, then test against an isolated local Worker:

```sh
cargo build --manifest-path ../warden-desktop/Cargo.toml --example plico_login_probe
node scripts/bw-compat-local.ts --demo --plico-probe=../warden-desktop/target/debug/examples/plico_login_probe
```

This runs Plico's real native input bindings and Rust SDK actor against the five
synthetic demo entries: password login, initial sync, browse details, refresh,
and lock clearing. The probe receives credentials on stdin and returns only
status/counts. The harness creates temporary D1 state and a trusted test leaf
certificate, then removes both. It does not change the deployed service or the
developer's local database. Without `--demo`, the harness registers a disposable
account in the isolated database. The regular `test:compat:bw:local` command keeps
running the official CLI's broader CRUD suite.

Validation for this change: 326 API unit/scenario tests plus four Worker-pool
tests pass, TypeScript checking passes, both five-item demo and freshly registered
empty-vault Plico probes pass, and the official CLI extended compatibility suite
passes (auth/session, sync, personal item types, lifecycle, attachments and Sends).
