# Architecture

## Tech Stack

### Frontend

- **Next.js**: React framework with App Router + Turbopack
- **React / TypeScript**: Type-safe UI
- **Tailwind CSS**: Styling
- **Radix UI**: Accessible UI primitives (via shadcn/ui)
- **TipTap**: Rich text editor
- **Motion**: Animations
- **Lucide React**: Icons

### Backend

- **Convex**: Real-time backend — type-safe APIs, real-time subscriptions, file storage, caching
- **@convex-dev/auth**: Password-based authentication (Argon2 hashing)

### Blockchain

- **Stellar Network**: Payment processing via XLM
- **Soroban Smart Contracts** (Rust):
  - Unified tipping contract (article + highlight tips, fee distribution)
  - NFT minting with Arweave metadata
- **Arweave Network**: Permanent content storage via Turbo SDK (FREE for < 100 KiB)

## Project Structure

```text
app/                    Next.js app router pages
├── (auth)/             Authentication pages (login, register)
├── [username]/         User profiles
├── articles/           Article views
├── write/              Editor interface
└── drafts/             Draft management
components/             React components
├── article/            Article-specific components
├── editor/             TipTap editor components
├── ui/                 Shared UI components (Radix/shadcn)
└── user/               User-related components
convex/                 Backend functions
├── articles.ts         Article CRUD
├── auth.ts             Authentication (Password provider)
├── highlights.ts       Highlight management
├── highlightTips.ts    Highlight tipping
├── nfts.ts             NFT operations
├── arweave.ts          Arweave integration
├── tips.ts             Tipping transactions
├── uploads.ts          File storage
└── users.ts            User management
contracts/              Stellar smart contracts
├── tipping/            Unified tipping contract
└── article-nft/        NFT minting contract
hooks/                  Custom React hooks
lib/                    Utilities
├── stellar/            Stellar config + wallet adapter
└── arweave/            Arweave config + client
types/                  TypeScript definitions
```

## Database Schema (Convex)

```text
users          User profiles and authentication
articles       Published content and drafts
tips           Transaction records
highlights     Interactive annotations
highlightTips  Highlight-specific tips
articleNFTs    Minted article NFTs
authorEarnings Author revenue tracking
fileUploads    Media storage metadata
withdrawals    Payout history
tags           Content categorization
```

## Smart Contracts

Two Soroban contracts (Rust). Not needed for frontend dev.

### Tipping Contract

- **Immediate Settlement**: Direct XLM transfers
- **Fee Distribution**: 97.5% author, 2.5% platform
- **Minimum Tip**: 0.01 XLM (~$0.001)
- **Event Logging**: On-chain transaction history

### NFT Contract

- **Threshold Minting**: Requires minimum tip amount
- **Unique Tokens**: One NFT per article
- **Transfer Support**: Full ownership transfer
- **Arweave Metadata**: Permanent on-chain article reference

## Deployed Contracts (Testnet)

Two Soroban contracts deployed on Stellar Testnet.

| Contract        | ID                                                         | Env var                           |
| --------------- | ---------------------------------------------------------- | --------------------------------- |
| Unified Tipping | `CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY` | `NEXT_PUBLIC_TIPPING_CONTRACT_ID` |
| Article NFT     | `CAS44OQK7A6W5FDRAH3K3ZN7TTQTJ5ESRVG6MB2HBVFWZ5TVH26UUB4S` | `NEXT_PUBLIC_NFT_CONTRACT_ID`     |

**Historical note:** An earlier separate highlight-tipping contract (`CDON...64AB`) was used during initial development. It was retired when highlight tipping was merged into the unified tipping contract. The previous unified testnet contract (`CASU...CVWG`) was replaced by the upgraded unified tipping contract above. The env var `NEXT_PUBLIC_HIGHLIGHT_CONTRACT_ID` is no longer needed.

## Project Deliverables

### Deliverable 1: Granular Highlight Tipping

Phrase-level tipping — readers select text, tip specific highlights, authors see a heatmap of which phrases earned the most.

**Key concepts:**

- **Highlight ID**: `SHA256(articleSlug:startOffset:endOffset:text[0:50])`, truncated to 28 chars for Stellar memo
- **Inline UX**: TipTap mark extension renders highlights directly in text; popover appears on selection
- **Heatmap**: Yellow → Orange → Red gradient based on tip totals per highlight

**Status:** Implementation complete, pending user validation.
See [highlight-tipping.md](highlight-tipping.md) for contract history, DB schema, and component map.

### Deliverable 2: Permanent Content Storage (Arweave)

Articles stored permanently on Arweave via Turbo SDK (FREE for < 100 KiB).

**Key concepts:**

- Background job uploads article JSON on publish
- Verification job confirms permanent storage after ~10 min
- Status flow: `pending` → `uploaded` → `verified`

**Status:** Implementation complete.

## Arweave Integration

1. **Publish**: Article is queued for Arweave upload
2. **Upload**: Background job uploads article JSON (FREE for < 100 KiB)
3. **Verify**: Verification job confirms permanent storage
4. **Display**: Article page shows "Permanent Storage" status with Arweave link

Status flow: `pending` → `uploaded` → `verified`

View on blockchain: `https://arweave.net/{txId}`
