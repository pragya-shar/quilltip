# Setup

## Prerequisites

- Node.js 20+
- [Bun](https://bun.sh) (project uses `bun.lock`; npm/yarn also work)
- A free [Convex](https://convex.dev) account
- Stellar wallet (only for blockchain features)

## Wallet install / connect troubleshooting

If you click **Connect Wallet** and don’t have any Stellar wallet installed, Quilltip will show an install dialog with links to supported wallets. After installing a wallet, **reload the page** and try connecting again.

To test this behavior locally:

- **No-wallet flow**:
  - Open Chrome with a fresh profile (or a browser where you have no Stellar wallet extensions installed).
  - Run `bun run dev` and open Quilltip.
  - Click **Connect Wallet** (from the header, wallet status card, tipping modal, or minting modal).
  - Expected: install dialog appears with links for **Freighter**, **xBull**, **Albedo**, **HOT Wallet** (and the wallet selection modal does not open empty).
- **After install + reload**:
  - Install one wallet from the provided link.
  - Reload the page.
  - Click **Connect Wallet** again.
  - Expected: the normal wallet selection/connect flow works as before.

## Installation

```bash
bun install
cp .env.example .env.local
npx convex dev --once
npx convex env set SITE_URL http://localhost:3000
bun run dev
```

## Environment Variables

See [`.env.example`](../.env.example) for the template. Only Convex vars are required — everything else has defaults or is optional:

| Variable                          | Source                         | Required                 |
| --------------------------------- | ------------------------------ | ------------------------ |
| `CONVEX_DEPLOYMENT`               | Auto — `npx convex dev`        | Yes                      |
| `NEXT_PUBLIC_CONVEX_URL`          | Auto — `npx convex dev`        | Yes                      |
| `NEXT_PUBLIC_PLATFORM_ADDRESS`    | `.env.example` default         | For tipping              |
| `NEXT_PUBLIC_TIPPING_CONTRACT_ID` | Deploy contract or leave blank | For tipping              |
| `NEXT_PUBLIC_NFT_CONTRACT_ID`     | Deploy contract or leave blank | For NFTs                 |
| `ARWEAVE_ENABLED`                 | `false` by default             | For permanent storage    |
| `ARWEAVE_WALLET_KEY`              | Arweave JWK wallet             | Only for files > 100 KiB |

Stellar network vars (`NEXT_PUBLIC_STELLAR_NETWORK`, `NEXT_PUBLIC_HORIZON_URL`, `NEXT_PUBLIC_SOROBAN_RPC_URL`, `NEXT_PUBLIC_NETWORK_PASSPHRASE`) all have built-in testnet defaults — no config needed for dev.

## Authentication

Auth uses Convex Auth with the Password provider (defined in `convex/auth.ts`). The `SITE_URL` environment variable is set on the **Convex deployment** (not in `.env.local`):

```bash
npx convex env set SITE_URL http://localhost:3000
```

This is read by `convex/auth.config.ts` as `process.env.CONVEX_SITE_URL`.

## Tip Verification

The Convex action that verifies Stellar tip transactions needs the tipping contract ID at runtime. Set it on the **Convex deployment**:

```bash
npx convex env set TIPPING_CONTRACT_ID <your-tipping-contract-id>
```

For testnet, use the same value as `NEXT_PUBLIC_TIPPING_CONTRACT_ID` in `.env.local`. Without this, tip verification will throw and tips will remain `PENDING`.

## Development Commands

```bash
bun run dev              # Next.js (Turbopack) + Convex dev server
bun run dev:frontend     # Next.js only
bun run dev:backend      # Convex only
bun run build            # Production build
bun run start            # Start production server
bun run lint             # ESLint
bun run typecheck        # TypeScript validation
bun test                 # Vitest
bun run test:coverage    # Coverage report
```
