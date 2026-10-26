# Local setup

Use Node.js 24 LTS and the Bun version in `package.json`'s `packageManager` field.
Install from `bun.lock`; do not mix package-manager lockfiles. A Convex account
and development deployment are required. Wallet/contract tools are needed only
for payment or contract work.

## First checkout

```bash
bun install --frozen-lockfile
cp .env.example .env.local
bunx convex dev --once
bunx convex env set SITE_URL http://localhost:3000
bun run dev
```

Choose the intended **development** deployment during Convex setup. Initial
Convex Auth signing-key setup is covered by the
[auth setup guide](https://labs.convex.dev/auth/setup). Existing deployments may
already have it; keep keys on Convex, never in tracked files.

`bun run dev` first runs `predev` (`convex dev --until-success`), then starts
Next.js and Convex together. This can push functions/schema to the configured
backend. For UI-only work against an already configured backend, use
`bun run dev:frontend`. Start `bun run dev:backend` separately only when needed.

Before reusing `http://localhost:3000`, inspect the listener and its checkout:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -a -p <listener-pid> -d cwd
```

An HTTP 200 or `EADDRINUSE` does not identify which checkout is serving the app.
Avoid launching a duplicate backend or stopping another chat's server.

## Environment

[.env.example](../.env.example) contains local placeholders. Convex setup writes
`CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into `.env.local`.
`SITE_URL` is the app/auth redirect origin on Convex; `CONVEX_SITE_URL` is Convex's
own HTTP-action origin, provided by Convex and used in `convex/auth.config.ts`.

| Feature                | Local Next.js environment                                              | Convex deployment environment                                      |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| App/auth               | Generated Convex URL                                                   | `SITE_URL`; Auth signing configuration                             |
| Article/highlight tips | `NEXT_PUBLIC_TIPPING_CONTRACT_ID`, `NEXT_PUBLIC_PLATFORM_ADDRESS`      | `TIPPING_CONTRACT_ID`, `STELLAR_NETWORK=TESTNET`                   |
| NFT                    | `NEXT_PUBLIC_NFT_CONTRACT_ID`; optional `NEXT_PUBLIC_NFT_METADATA_URL` | Check the affected backend function's requirements                 |
| Permanent publishing   | `ARWEAVE_ENABLED=false` by default                                     | `ARWEAVE_ENABLED`, `ARWEAVE_WALLET_KEY` when intentionally enabled |

Frontend/backend tipping IDs and network must match. The browser's Stellar
endpoints/passphrase default to testnet in `lib/stellar/config.ts`; backend
verification configuration lives in `convex/lib/constants.ts`. Missing backend
contract configuration blocks quote preparation before wallet approval.
Arweave wallet configuration is required by `convex/arweave.ts` when enabled,
including for small uploads; keep it only on the backend.

## Checks and browser tests

Run `bun run check` for the local code/tooling gate; `package.json` lists individual
checks. Playwright uses an existing server rather than launching one. For example:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 bunx playwright test e2e/site-chrome.spec.ts
```

Install Playwright's Chromium browser if the runner requests it. See
[playwright.config.ts](../playwright.config.ts) for defaults and
[behavioral QA](workflow/qa-checklist.md) for evidence requirements.

Signed-in navigation coverage lives in `e2e/account-navigation.spec.ts`. Run it
against a frontend configured for a **development** Convex deployment, using a
dedicated disposable account created through `/register`. Supply that account's
email and password as `PLAYWRIGHT_QA_EMAIL` and `PLAYWRIGHT_QA_PASSWORD` through
your local environment or secret manager, then run:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 bunx playwright test e2e/account-navigation.spec.ts
```

Without both variables the spec skips explicitly. Each test uses a fresh browser
context and signs in through `/login`; sign-out tests have independent sessions.
The spec disables traces, screenshots, and video to avoid capturing credentials.
Do not commit credentials or saved browser state. It follows desktop/mobile
destinations, holds real Convex responses to check auth loading, and signs out;
it does not publish articles, edit content, or send wallet transactions.

For wallet install/connect QA, test once without an extension, then install a
supported Stellar wallet, reload, and verify the connection flow. Signed wallet
operations and permanent publishing require the correct target environment.
