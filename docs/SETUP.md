# Local setup

Use Node.js 24 LTS and the Bun version in `package.json`'s `packageManager` field.
`@stellar/stellar-sdk` 17 needs Node.js 22.12 or later; `package.json` `engines`
states this for hosting builds.
Install from `bun.lock`; do not mix package-manager lockfiles. A Convex account
and development deployment are required. Wallet/contract tools are needed only
for payment or contract work.

`bun run check` refuses to start on a Bun older than the pinned version. If your
installed Bun is older, run scripts through `npx bun@<pinned version> run <script>`.

## First checkout

```bash
bun install --frozen-lockfile
cp .env.example .env.local
# Set CONVEX_DEPLOYMENT and NEXT_PUBLIC_CONVEX_URL to a non-production
# deployment (see "Convex deployments"), then:
bun run guard:convex
bunx convex dev --once
bunx convex env set SITE_URL http://localhost:3000
bun run dev
```

Choose the intended **development** deployment during Convex setup. Initial
Convex Auth signing-key setup is covered by the
[auth setup guide](https://labs.convex.dev/auth/setup). Existing deployments may
already have it; keep keys on Convex, never in tracked files.

`bun run dev` first runs `predev` (`scripts/convex-dev.ts`: the Convex guard,
then `convex dev --until-success`), then starts Next.js and Convex together. This can push functions/schema to the configured
backend. For UI-only work against an already configured backend, use
`bun run dev:frontend`; it runs the operational guard before starting Next.js. Start `bun run dev:backend` separately only when needed.

Before reusing `http://localhost:3000`, inspect the listener and its checkout:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -a -p <listener-pid> -d cwd
```

An HTTP 200 or `EADDRINUSE` does not identify which checkout is serving the app.
Avoid launching a duplicate backend or stopping another chat's server.

## Convex deployments

| Deployment               | Type | Use                                                       |
| ------------------------ | ---- | --------------------------------------------------------- |
| `efficient-tern-39`      | dev  | v2 integration and operational testing on Stellar testnet |
| `upbeat-mockingbird-579` | —    | Serves the live site. Guarded tools refuse it by default. |

`efficient-tern-39` (`https://efficient-tern-39.convex.cloud`) is the shared
non-production backend for v2 work. It is configured with `STELLAR_NETWORK=TESTNET`,
the testnet tipping contract, `ARWEAVE_ENABLED=false`, and its own Auth signing
keys. To target it, put these lines in `.env.local`:

```bash
CONVEX_DEPLOYMENT=dev:efficient-tern-39
NEXT_PUBLIC_CONVEX_URL=https://efficient-tern-39.convex.cloud
QUILLTIP_NETWORK_GUARD_OPT_IN=testnet
```

Data on this deployment is disposable test data. Pushing functions to it with
`bun run dev:backend` (add `--once` for a single push) updates the shared
integration backend, so coordinate before pushing schema changes.

## Testnet guard

Tools that submit Stellar transactions or change a Convex deployment must call the
testnet guard before doing any work. Each call states its kind:

- **Operational** runs exercise app or backend flows that record testnet activity.
  Use `assertScriptTestnetOnly(operation)` or `bun run guard:testnet`.
- **Deploy** work pushes functions or schema, imports data, runs migrations, or
  changes deployment env. Use `assertScriptConvexDeployAllowed(operation)` or
  `bun run guard:convex`. `predev` and `dev:backend` run `scripts/convex-dev.ts`,
  which runs this check and then `convex dev`. It refuses flags that can select
  another deployment (`--prod`, `--url`, `--admin-key`, `--deployment`,
  `--deployment-name`, `--env-file`, `--configure`, and others). Run other
  Convex CLI commands only after `bun run guard:convex` passes in the same
  environment.
- Playwright runs must target a local app server. Suites that use a Convex
  backend also run the operational guard; `bun run test:e2e:fixtures` needs no
  backend.
- Convex functions: `assertBackendTestnet()` for network checks, and
  `assertNonProductionBackend(operation)` for maintenance functions (deploy kind).

Script helpers live in `scripts/lib/network-guard.ts`; the shared logic is in
`convex/lib/networkGuard.ts`. Every run needs `QUILLTIP_NETWORK_GUARD_OPT_IN=testnet`.
The guard applies two separate controls:

1. **Stellar network.** Only `TESTNET` is accepted. A missing or conflicting
   network, the mainnet passphrase, an unknown passphrase, a mainnet Horizon or RPC
   URL, or an unknown endpoint is refused. Mainnet has no override.
2. **Convex backend allowlist.** The target must be a local backend or a
   deployment on the allowlist in `convex/lib/networkGuard.ts`. Add a personal
   non-production deployment with `QUILLTIP_CONVEX_ALLOWLIST` (comma-separated).
   Production-type deployments are refused. The live backend is refused by
   default and cannot be added to the allowlist. An owner-approved operational
   run may target it only when `QUILLTIP_LIVE_BACKEND_OPERATIONAL_APPROVAL` is set
   to the live deployment name for that run. Deploy work is refused on the live
   backend even with that variable, and deploy work refuses to run while the
   variable is set. Never put it in a shared `.env` file.

The guard has no bypass: change the configuration instead.

Production releases follow [deployment](DEPLOYMENT.md) and are outside the guard.

## Environment

[.env.example](../.env.example) contains local placeholders. Convex setup writes
`CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` into `.env.local`.
`SITE_URL` is the app/auth redirect origin on Convex; `CONVEX_SITE_URL` is Convex's
own HTTP-action origin, provided by Convex and used in `convex/auth.config.ts`.

| Feature                | Local Next.js environment                                                                                                | Convex deployment environment                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| App/auth               | Generated Convex URL                                                                                                     | `SITE_URL`; Auth signing configuration                             |
| Article/highlight tips | `NEXT_PUBLIC_TIPPING_CONTRACT_ID`, `NEXT_PUBLIC_PLATFORM_ADDRESS`                                                        | `TIPPING_CONTRACT_ID`, `STELLAR_NETWORK=TESTNET`                   |
| NFT                    | `NEXT_PUBLIC_NFT_CONTRACT_ID`; optional `NEXT_PUBLIC_NFT_METADATA_URL`                                                   | Check the affected backend function's requirements                 |
| Permanent publishing   | `ARWEAVE_ENABLED=false` by default                                                                                       | `ARWEAVE_ENABLED`, `ARWEAVE_WALLET_KEY` when intentionally enabled |
| Product analytics      | `NEXT_PUBLIC_ANALYTICS_ENABLED=false` by default; server-only `ANALYTICS_POSTHOG_KEY`, optional `ANALYTICS_POSTHOG_HOST` | None                                                               |
| Password reset         | None                                                                                                                     | `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`; uses `SITE_URL` for the link |

Frontend/backend tipping IDs and network must match. `NEXT_PUBLIC_STELLAR_NETWORK`
and `STELLAR_NETWORK` accept only `TESTNET` or `MAINNET`. Network settings (wallet
network, passphrase, Horizon and RPC defaults) come from one module,
`convex/lib/stellarNetwork.ts`, used by the browser config, the wallet adapter,
the backend, and scripts. The backend currently accepts only `TESTNET`. When the
XLM price cache is unavailable, the browser uses a fixed practice rate on
`TESTNET` and refuses to quote on any other network. Missing backend
contract configuration blocks quote preparation before wallet approval.
Arweave wallet configuration is required by `convex/arweave.ts` when enabled,
including for small uploads; keep it only on the backend.

### Beta programme

- **Waitlist:** `/waitlist` stores one row per email in the `waitlist` table
  with status `pending`. Spam protection is a honeypot field, a minimum fill
  time, and a global limit of 30 new rows per minute; responses are the same
  for new and existing emails. Mark entries invited with
  `waitlist:invite` (dry run unless `"apply": true`) and send the invitation
  yourself. A new account with the same email marks the entry `joined`.
- **Feedback:** signed-in people send feedback from `/dashboard/feedback`
  (5 per person per hour). Read it with `feedback:listRecent`.
- **Usage metrics:** `betaMetrics:getUsageMetrics` is an internal action for
  people with deployment access. It reads each table in pages and excludes
  test accounts unless called with `{"excludeTestAccounts": false}`.
- **Test accounts:** flag QA and demo accounts with
  `testAccounts:setTestAccount '{"email":"…","isTestAccount":true}'`. Only
  internal functions can set the flag.
- **Product analytics:** PostHog (EU cloud), off by default. Set
  `NEXT_PUBLIC_ANALYTICS_ENABLED=true` and the server-only
  `ANALYTICS_POSTHOG_KEY` (the project API key) on the Next.js deployment.
  Visitors see a consent prompt; nothing is sent until they allow it, and Do
  Not Track or Global Privacy Control count as a refusal. Events go through
  `/api/analytics`, so visitor IP addresses are not shared with PostHog, and
  only `$pageview`, `waitlist_joined` and `feedback_sent` are accepted, with
  no free-text properties. The prompt and relay stay off until both variables
  are set.

### Password reset

`/forgot-password` asks for an email and `/reset-password` takes the emailed
8-digit code and a new password. Codes come from Convex Auth's reset flow,
expire after 15 minutes, and work once. Email goes through
[Resend](https://resend.com) over HTTPS, so no SDK is installed:

- `AUTH_RESEND_KEY`: Resend API key, set on the Convex deployment.
- `AUTH_EMAIL_FROM`: sender such as `QuillTip <no-reply@your-domain>`, on a
  domain verified in Resend. Without it, Resend's shared test sender is used,
  which delivers only to the Resend account owner.

Without `AUTH_RESEND_KEY` the request step says reset email is unavailable and
sends nothing. The response is the same for known and unknown emails; requests
are limited to 3 per email per hour and 50 per 10 minutes overall, and wrong
codes count toward Convex Auth's failed sign-in limit. A completed reset signs
out other sessions and returns the person to log in.

## Checks and browser tests

Run `bun run check` for the local code/tooling gate; `package.json` lists individual
checks. Its build step uses a placeholder `NEXT_PUBLIC_CONVEX_URL` when none is set.
`bun run test:unit` covers the network module, guard, health report, and profile
helpers. `bun run test:e2e:fixtures` starts the NFT, recovery, and avatar fixture
servers and runs their Playwright suites; they need no backend or credentials.
`bun run test:contracts` runs `cargo test` for each contract. Each crate pins its
Rust toolchain (1.94.1) and the `wasm32v1-none` target in `rust-toolchain.toml`;
build a contract with `cargo build --locked --target wasm32v1-none --release`
inside its directory. Live-route Playwright suites use an existing server rather than launching
one. For example:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 bunx playwright test e2e/site-chrome.spec.ts
```

Install Playwright's Chromium browser if the runner requests it. See
[playwright.config.ts](../playwright.config.ts) for defaults and
[behavioral QA](workflow/qa-checklist.md) for evidence requirements.

The console test command runs both the live public-page console suite and all
seven article selection regressions:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 bun run test:e2e:eng-224
```

Start a production build (`bun run build`, then `bun run start`) at the selected
URL first; development-mode console messages intentionally fail the live suite.
Neither suite requires sign-in credentials. The selection regressions use
isolated DOM fixtures and can also run without an app server or backend:

```bash
bunx playwright test e2e/article-console-selection.spec.ts
```

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
