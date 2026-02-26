# Security Policy

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Email **<security@quilltip.me>** with:

- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what can an attacker do?)

You should receive acknowledgment within **48 hours**. We aim to release a fix within **7 days** for critical issues.

## Scope

The following are in scope:

- Authentication and session handling (Convex Auth)
- Stellar wallet interactions and tipping contract logic
- Arweave upload and storage key management
- API route authorization
- Cross-site scripting via the TipTap editor
- Any exposure of private keys, secrets, or user data

## Out of Scope

- Stellar network or Soroban runtime vulnerabilities (report to SDF)
- Convex platform vulnerabilities (report to Convex)
- Arweave network vulnerabilities (report to Arweave)
- Denial of service via rate limiting (Vercel handles this)

## Supported Versions

Only the latest release on `main` is supported with security updates.

## Disclosure

We follow coordinated disclosure. We will credit reporters in the release notes unless anonymity is requested.
