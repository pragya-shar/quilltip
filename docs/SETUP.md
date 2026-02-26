# Setup

## Prerequisites

- Node.js 20+
- [Bun](https://bun.sh) (project uses `bun.lock`; npm/yarn also work)
- A free [Convex](https://convex.dev) account
- Stellar wallet (only for blockchain features)

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
