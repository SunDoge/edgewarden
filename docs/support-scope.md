# Support scope

Edgewarden is a focused, Cloudflare-native implementation of the Bitwarden
password-manager protocol. It is intended to provide a complete personal
password-manager experience and the basic organization features needed to
share vault items. It is not intended to reproduce the entire Bitwarden
business and enterprise platform.

This document is the product boundary, not merely a list of endpoints that
happen to exist today. A broken supported workflow is a compatibility bug. A
feature listed as out of scope is not implicitly planned just because the
official server implements it.

## Cloudflare platform rule

The Edgewarden server must remain deployable as one Cloudflare Worker plus
Cloudflare bindings. New server features are accepted only when they can be
implemented reliably within the Worker request/event model and the documented
limits of D1, R2, KV, Durable Objects, Queues, Cron Triggers and direct outbound
`fetch()` calls.

An optional third-party HTTP service may be integrated when the Worker can call
it directly and Edgewarden continues to operate without a separately hosted
companion process. This is why Turnstile, Bitwarden Push Relay, WebDAV and
S3-compatible backup targets fit the architecture.

The following dependencies do not fit the architecture and will be documented
as unsupported rather than emulated with a fragile partial implementation:

- An always-running Node.js, .NET or Rust process, container, or background
  daemon.
- A persistent host filesystem or a filesystem shared between requests.
- A locally hosted SMTP server, LDAP/Active Directory connector, directory-sync
  agent, or similar sidecar.
- Arbitrary inbound TCP/UDP services or protocols that cannot be terminated by
  Workers HTTP/WebSocket handling.
- Correctness that depends on long in-request jobs, process-local timers, or
  mutable in-memory state surviving between Worker invocations.

Cloudflare adding a suitable managed primitive may make a previously excluded
feature feasible. Such a feature still requires a security and compatibility
review before it enters the supported scope.

## Support levels

| Level | Meaning |
| --- | --- |
| Core | Part of the complete personal-vault goal. Missing behavior and official-client regressions should be fixed. |
| Basic | Supported for ordinary small-team sharing, without enterprise parity. |
| Edgewarden extension | An operational feature provided by Edgewarden rather than a Bitwarden protocol commitment. |
| Out of scope | Deliberately not promised. It may return an empty compatibility response when an official client expects the endpoint. |

## Personal accounts: core scope

Personal password-manager functionality is the primary compatibility target.
The goal is that a user can use Edgewarden as their normal vault with the
official Bitwarden clients, without falling back to the Edgewarden web app for
routine vault operations.

Core scope includes:

- Account registration, password login, logout, token refresh, API keys,
  password changes, account deletion, and session revocation.
- Official-client sync, account revision tracking, conflict detection, and
  background sync notifications when the optional Bitwarden Push Relay is
  configured.
- All personal cipher types accepted by current clients, including login,
  secure note, card, identity, SSH key, bank account, driver license, and
  passport items.
- Custom fields, URI matching data, password history, per-item keys, reprompt,
  favorites, archive, trash, restore, and permanent deletion.
- Personal folders, including moving organization items into a user's own
  folder without changing another member's view.
- Encrypted attachments backed by R2, with KV available as a constrained
  compatibility backend.
- Text and file Send, including passwords, access limits, expiration, deletion,
  and public download flows.
- TOTP and Steam Guard data stored in vault items.
- Account two-step login with authenticator TOTP, WebAuthn/passkeys, and YubiKey
  OTP, including recovery codes and trusted-device flows.
- Account-login passkeys and login approval/auth-request flows supported by the
  official clients.
- Website passkeys stored in login items. Imports preserve their encrypted
  `fido2Credentials` payload.
- Equivalent-domain settings and generated Bitwarden global domain rules.
- Bitwarden JSON import and export. Unencrypted and password-protected JSON are
  supported; password-protected files support PBKDF2-SHA256 and Argon2id.
  Account-restricted exports remain bound to their original account by design.
- Edgewarden Web offline unlock and cache, followed by server reconciliation
  and stale-edit protection when connectivity returns.

“Complete personal support” applies to password-manager functionality. It does
not include every separate Bitwarden product or paid service attached to an
individual account. In particular, emergency access, email delivery, billing,
subscriptions, and hosted Bitwarden account services are outside this promise.

## Organizations: basic scope

Organizations are supported as a small-team encrypted-sharing feature. The
model intentionally stays simpler than current Bitwarden enterprise
organizations.

Basic organization support includes:

- Creating, renaming, and deleting an organization.
- Direct membership for existing Edgewarden accounts.
- Owner, administrator, manager, and member roles.
- Creating, renaming, and deleting collections.
- Granting a member access to selected collections, including read-only and
  hide-passwords permissions.
- Sharing organization ciphers through one or more collections.
- Official-client sync of organizations, collections, permissions, and shared
  ciphers.
- Editing and deleting shared ciphers according to the granted role and
  collection permissions.
- Per-member favorites, archive state, and personal folder placement for a
  shared cipher. One member's view state does not alter another member's view.
- Multiple owners represented through organization membership rather than a
  second owner field on the organization record.

Invitation does not currently send email. An administrator selects an existing
account by its normalized email address and grants that account an encrypted
organization key.

The schema reserves collection-level `manage` permission for protocol
evolution, but the current administration interface uses the simpler role-based
management model. This reserved field should not be read as a claim of full
Bitwarden flexible-collections parity.

## Deliberately out of scope

The following official-server areas are not part of the compatibility promise:

- Organization groups and group-based collection assignment.
- Enterprise policies and policy enforcement.
- SSO, SAML, OpenID Connect, Key Connector, and Login with SSO.
- SCIM, directory connector/sync, domain verification, and account claiming.
- Organization API keys, service accounts, Secrets Manager, and provider or
  reseller portals.
- Enterprise event export, SIEM integration, and the official organization
  event model. Edgewarden maintains its own security audit log instead.
- Billing, subscriptions, licensing, plans, seat limits, sponsorships, and
  storage purchases.
- Families-specific administration and collections behavior beyond what the
  basic organization model can express.
- Emergency access.
- Mail delivery, password-hint email, invite email, and email verification
  workflows. Edgewarden does not require an SMTP sidecar; deployments currently
  use bootstrap secrets and direct invitation instead. A future implementation
  would need a Worker-native, optional delivery binding or HTTP provider.
- Official web-vault administrative pages or exact visual parity with the
  Bitwarden web vault.
- Hosting every non-password-manager Bitwarden product.

## Edgewarden extensions

These features are supported operational capabilities but are not claims of
official Bitwarden Server parity:

- Cloudflare-native deployment to Workers with D1 and R2 or KV.
- Turnstile protection for registration and password login.
- Configurable registration, deployment-password bootstrap, and one-time
  email-bound registration invites.
- Encrypted full-instance backup and restore, including attachment files,
  remote R2/S3/WebDAV destinations, integrity manifests, and pre-restore
  relationship validation.
- D1-backed immutable audit tombstones and administrative security logs.
- Administration UI for users, registration, invitations, backup, storage,
  audit, and Push Relay status.

## Compatibility policy

Edgewarden implements behavior required by official clients rather than
matching the official database schema or internal service architecture. D1 and
Workers have different transaction, storage, and execution constraints, so an
intentional implementation difference is acceptable when the wire behavior and
security properties remain correct.

Compatibility is evaluated against the official CLI, browser extension,
desktop, Android, and iOS clients. The maintained acceptance matrix is in
[compatibility.md](compatibility.md). A future client release is not considered
supported until its relevant workflows have been tested, but failures in core
personal workflows remain high-priority compatibility bugs.

Unknown encrypted cipher fields should be preserved whenever possible. New
cryptographic account formats, key rotation protocols, or required sync fields
must be reviewed against the official server before Edgewarden advertises the
corresponding capability.
