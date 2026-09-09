# Security policy

## Report a vulnerability privately

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/SunDoge/edgewarden/security/advisories/new). Do not publish exploit details or secrets in issues, pull requests, or community posts. Edgewarden is independent of Bitwarden; report Edgewarden-specific problems here.

Include the affected release or commit, client and version, deployment backend (R2 or KV), reproduction steps, expected and actual behavior, and the security impact. Authentication bypass, cross-user access, token replay, vault data exposure, unsafe backup/restore, and secret handling are in scope. Redact passwords, tokens, recovery codes, private keys, and vault contents. Use disposable accounts for reproduction.

This project is maintained on a best-effort basis. We will investigate reports and coordinate fixes and disclosure with reporters; we cannot promise a response deadline or a paid bounty.

## Supported versions

Security fixes target the latest published release and the default branch. Older releases and modified forks are not maintained separately. Upgrade after reviewing the release notes and taking a backup.

## Security boundaries

Read [Security boundaries](docs/security.md) for the threat model, implemented defenses, and operator responsibilities. Automated scans and passing tests do not constitute an independent security audit.
