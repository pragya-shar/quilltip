# Local setup

Use Node.js 24 LTS and the Bun version in `package.json`'s `packageManager` field.
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

`bun run dev` first runs `predev` (the Convex guard, then
`convex dev --until-success`), then starts Next.js and Convex together. This can push functions/schema to the configured
backend. For UI-only work against an already configured backend, use
`bun run dev:frontend`. Start `bun run dev:backend` separately only when needed.

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
| `upbeat-mockingbird-579` | —    | Serves the live site. Never target it from local tools.   |

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
`bun run dev:backend` or `bunx convex dev --once` updates the shared integration
backend, so coordinate before pushing schema changes.

## Testnet guard

Tools that submit Stellar transactions or change a Convex deployment must call the
testnet guard before doing any work:

- Scripts: `assertScriptTestnetOnly(operation)` or, for Convex-only tools,
  `assertScriptNonProductionConvex(operation)` from `scripts/lib/network-guard.ts`.
- Package scripts and shell steps: `bun run guard:testnet` or `bun run guard:convex`.
- Convex functions: `assertBackendTestnet()` for network checks and
  `assertNonProductionBackend(operation)` for operational functions, from
  `convex/lib/networkGuard.ts`.

The guard refuses to continue when `QUILLTIP_NETWORK_GUARD_OPT_IN` is not
`testnet`; when the Stellar network is missing or not `TESTNET`; when the
passphrase or a Horizon/RPC URL is a mainnet value or an unknown host; or when the
Convex URL, `CONVEX_DEPLOYMENT`, or deploy key names a production-type deployment or
a deployment in the production list in `convex/lib/networkGuard.ts`. Add more names
with `QUILLTIP_PRODUCTION_CONVEX_DEPLOYMENTS` (comma-separated). It never bypasses:
change the configuration instead.

Production releases follow [deployment](DEPLOYMENT.md) and are outside the guard.

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
