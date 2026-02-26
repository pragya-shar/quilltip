# NFT Roadmap

Article NFT system — ~60% of infrastructure already exists.

## What Exists Today

### Smart Contract (`contracts/article-nft/src/lib.rs`)

- `mint_article_nft(author, article_id, tip_amount, url)` — threshold-gated minting
- `mint_article_nft_with_arweave(..., arweave_tx_id)` — stores Arweave ref in token
- `transfer(from, to, token_id)` — full ownership transfer
- `pause()` / `unpause()` / `is_paused()` — OpenZeppelin Pausable
- Article-to-NFT mapping prevents duplicate mints

Deployed on testnet: `CAS44OQK7A6W5FDRAH3K3ZN7TTQTJ5ESRVG6MB2HBVFWZ5TVH26UUB4S`

### Frontend Components

| Component      | File                                | Status                         |
| -------------- | ----------------------------------- | ------------------------------ |
| MintButton     | `components/nft/MintButton.tsx`     | Working — connects to contract |
| NFTBadge       | `components/nft/NFTBadge.tsx`       | Working — visual indicator     |
| TransferModal  | `components/nft/TransferModal.tsx`  | Working — transfer UI          |
| NFTIntegration | `components/nft/NFTIntegration.tsx` | Working — main management view |

### Backend

- `convex/nfts.ts` — mint, transfer, query operations
- `convex/schema.ts` — `articleNFTs` and `nftTransfers` tables
- `lib/stellar/nft-client.ts` — Stellar transaction builder for NFT ops

## Phases

### Phase 1: Contract Deployment & Enhancements — Complete

- Contract deployed to testnet
- Arweave metadata support added
- Pausable pattern added
- Frontend components connected

### Phase 2: Marketplace — Not Started

- Marketplace smart contract (`list_nft`, `buy_nft`, `make_offer`, `cancel_listing`)
- `/marketplace` route with listings, filtering, NFT detail view
- Convex tables: `nftListings`, `nftOffers`
- Royalty support (basis points per NFT)

### Phase 3: Ownership & History — Not Started

- On-chain ownership verification
- NFT holder benefits (ad-free reading, verified badge, exclusive content)
- Complete transfer history with provenance chain visualization
- Price appreciation tracking

### Phase 4: Granular Tipping Integration — Not Started

- Heatmap overlay on NFT articles
- Dynamic NFT metadata (rarity based on tip distribution)
- Bonus royalties for highly-tipped sections
