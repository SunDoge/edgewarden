# Security boundaries

Edgewarden is zero-knowledge only when clients encrypt sensitive vault fields before sending them. The server stores encrypted cipher payloads and attachment bytes, but account metadata, organization membership, audit metadata, and operational configuration are visible to the Worker and D1 administrators.

## Required practices

- Generate `JWT_SECRET`, `DATA_ENCRYPTION_SECRET`, and `BOOTSTRAP_SECRET` independently. Do not hash them before configuring Worker secrets.
- Treat the optional `PUSH_INSTALLATION_ID` and `PUSH_INSTALLATION_KEY` as secrets. Use one pair per deployment and never commit them; mobile Push Relay remains disabled unless both are configured.
- Keep public registration disabled unless needed. Prefer email-bound, single-use invitations and enable Turnstile on login and registration.
- Use HTTPS only. Refresh credentials for the Web Vault are HttpOnly, Secure on HTTPS, SameSite=Strict cookies; official clients receive protocol-compatible tokens.
- Treat every backup as sensitive even though vault fields are encrypted. Store it separately from `DATA_ENCRYPTION_SECRET` and test restoration periodically.
- Review audit events and rotate secrets after suspected compromise. Rotating `JWT_SECRET` invalidates signed tokens; rotating `DATA_ENCRYPTION_SECRET` requires re-encrypting persisted protected configuration first.

## Implemented defenses

- short-lived signed access, upload, download, Send, realtime, and action tokens with strict purposes and domain-separated signing keys derived from `JWT_SECRET`;
- refresh-token rotation and replay rejection;
- hashed refresh tokens, API keys, invitation codes, and auth-request access codes at rest;
- AES-GCM protection for recoverable API keys, TOTP secrets, recovery codes, invitation codes, and auth-request access codes using purpose-specific keys derived from `DATA_ENCRYPTION_SECRET`;
- device session stamps and server-side revocation;
- Cloudflare IP/account rate limits plus hashed, persisted account login lockout;
- request body limits by content type;
- strict CORS allowlisting for same-origin, browser extensions, and configured origins;
- organization/collection authorization middleware and database ownership constraints;
- optimistic cipher revisions and unknown-field preservation;
- HIBP password checks using k-anonymity, with secrets omitted from requests;
- local-only QR decoding: selected authenticator images are processed in the browser and are not uploaded.

No implementation can protect vault contents from a compromised browser, malicious extension, stolen unlocked device, or an attacker controlling the served JavaScript. Use Cloudflare account MFA, protected release branches, dependency review, and signed/reviewed changes.
