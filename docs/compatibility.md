# Client compatibility

Edgewarden implements the Bitwarden password-manager protocol; it is not a drop-in implementation of every Bitwarden product. Personal vaults, folders, organizations and collections, attachments, Send, TOTP/Steam Guard, passkeys, YubiKey OTP, login requests, import/export, and instance backup are in scope. Enterprise billing, SCIM, SSO, directory sync, emergency access, and mail delivery are not.

Bitwarden unencrypted JSON import preserves stored website passkeys in `login.fido2Credentials` and encrypts every credential field locally before upload. Passkeys used to sign in to a Bitwarden account are RP-bound account credentials rather than vault items; create new account-login passkeys for the Edgewarden hostname after migration.

Cipher payloads preserve unknown top-level and type-specific fields. Mutations carrying `lastKnownRevisionDate` use optimistic concurrency control and return HTTP 409 instead of overwriting a newer revision.

## Automated CLI smoke test

Install the official `bw` binary with mise (`mise install`), point the test at a disposable account, and run:

```sh
BW_SERVER=https://edgewarden.example.com \
BW_EMAIL=compat@example.com \
BW_PASSWORD='disposable-password' \
pnpm test:compat:bw
```

The TypeScript test uses an isolated temporary CLI profile and covers password login, lock/unlock, sync, folder and item CRUD, and attachment upload/download. It deletes created data in a `finally` block. Never target an important account.

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
