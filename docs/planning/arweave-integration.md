# Arweave Integration

Permanent content storage for published articles via Arweave blockchain.

## Overview

- **SDK**: Turbo SDK (`@ardrive/turbo-sdk`) — free uploads under 100 KiB, no wallet needed
- **Typical article**: 5–50 KiB JSON → most upload for free
- **Data lands on real Arweave** with real transaction IDs; Turbo is just a bundler/gateway
- **Wallet key** (`ARWEAVE_WALLET_KEY`) only required for files > 100 KiB

## Status Flow

```text
publish article
  → Convex sets arweaveStatus = "pending"
  → Background action uploads via Turbo SDK
  → On success: status = "uploaded", arweaveTxId stored
  → Verification job (10 min later): status = "verified"
  → On failure: status = "failed", logged
```

View on blockchain: `https://arweave.net/{txId}`

## Upload Flow (Detail)

1. `convex/articles.ts` — `publishArticle` schedules `internal.arweave.uploadArticleToArweave`
2. `convex/arweave.ts` — `uploadArticleToArweave` action:
   - Reads article + author via `getArticleForUpload` query
   - Calls `uploadArticle()` from `lib/arweave/client.ts`
   - On success: `recordArweaveUpload` mutation stores txId, schedules verification
   - On failure (3 retries with exponential backoff): `recordArweaveFailure`
3. `convex/arweave.ts` — `verifyArweaveUpload` action:
   - Calls `getTransactionStatus()` → checks `block_height`
   - If confirmed: updates status to `"verified"`
   - If not: reschedules itself in 10 min

## Database Fields

Added to `articles` table in `convex/schema.ts`:

| Field              | Type               | Purpose                                        |
| ------------------ | ------------------ | ---------------------------------------------- |
| `arweaveTxId`      | `optional(string)` | 43-char Arweave transaction ID                 |
| `arweaveUrl`       | `optional(string)` | `https://arweave.net/{txId}`                   |
| `arweaveStatus`    | `optional(string)` | `pending` / `uploaded` / `verified` / `failed` |
| `arweaveTimestamp` | `optional(number)` | Upload timestamp                               |
| `contentVersion`   | `optional(number)` | Version tracking                               |

## Key Files

| File                                    | Role                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| `lib/arweave/config.ts`                 | `ARWEAVE_CONFIG` — enabled flag, app name/version                    |
| `lib/arweave/client.ts`                 | `uploadArticle()`, `getArticle()`, `getTransactionStatus()`          |
| `lib/arweave/types.ts`                  | `ArweaveArticleContent`, `ArweaveStatus`, `ArweaveUploadResult`      |
| `convex/arweave.ts`                     | Background upload + verification actions                             |
| `convex/arweaveHelpers.ts`              | `recordArweaveUpload`, `recordArweaveFailure`, `updateArweaveStatus` |
| `components/articles/ArweaveStatus.tsx` | UI badge showing storage status                                      |
| `lib/stellar/memo-utils.ts`             | Already handles Arweave TX IDs in Stellar memos                      |

## Environment Variables

| Variable             | Required | Notes                                     |
| -------------------- | -------- | ----------------------------------------- |
| `ARWEAVE_ENABLED`    | Yes      | `true` to enable uploads                  |
| `ARWEAVE_WALLET_KEY` | No\*     | JWK key — only needed for files > 100 KiB |

## Architecture Diagram

```text
Next.js Frontend
  ├── Convex (fast queries, real-time, drafts)
  ├── Stellar Testnet (payments, verification)
  └── Turbo SDK → Arweave (permanent storage, FREE < 100 KiB)
```

## Contracts: Arweave-Aware Functions

Both deployed contracts include Arweave-aware variants:

- **Tipping**: `tip_article_with_arweave()`, `tip_highlight_with_arweave()`
- **NFT**: `mint_article_nft_with_arweave()` — stores `arweave_tx_id` in token metadata

Both contracts also have OpenZeppelin Pausable (`pause()` / `unpause()` / `is_paused()`).

## Remaining Work: Turbo SDK Migration

The codebase still uses the raw `arweave` package in some paths. Migration steps:

| Step                                                                 | Status  |
| -------------------------------------------------------------------- | ------- |
| Install `@ardrive/turbo-sdk`                                         | Pending |
| Update `lib/arweave/client.ts` to use `TurboFactory`                 | Pending |
| Update `lib/arweave/config.ts` (simplify — no gateway config needed) | Pending |
| Update `convex/arweave.ts` import paths                              | Pending |
| Remove `arweave` package from `package.json`                         | Pending |
| Test upload flow end-to-end                                          | Pending |

### Server-Side Wallet for Authenticated Uploads

For larger files or when a signing identity is desired:

```typescript
import { TurboFactory, ArweaveSigner } from '@ardrive/turbo-sdk/node'
const signer = new ArweaveSigner(parseWalletKey(process.env.ARWEAVE_WALLET_KEY))
const turbo = TurboFactory.authenticated({ signer })
```

All uploads are signed by QuillTip's server key — authors don't need Arweave accounts. Author info is stored in article metadata tags.
