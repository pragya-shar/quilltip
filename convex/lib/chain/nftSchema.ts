/**
 * Payments v2 article NFT schema pieces (docs/architecture/v2/06-app-integration.md,
 * section 6.2; 04-nft-contract.md). `convex/schema.ts` spreads these into
 * `articleNFTs` and `nftTransfers`; `convex/lib/chain/schema.ts` uses
 * `expectedNftValidator` on `chainSubmissions`.
 *
 * Every field is optional so v1 rows stay valid. A v2 row always sets
 * `contractVersion: 'v2'`, `network`, `chainEpoch` and the event fields; the
 * NFT event handlers are the only writers (convex/lib/chain/nftEventHandlers.ts).
 */
import { v } from 'convex/values'

const networkValidator = v.union(v.literal('TESTNET'), v.literal('MAINNET'))

/** Extra `articleNFTs` fields for v2 rows. Amounts are base-unit strings. */
export const nftChainFields = {
  network: v.optional(networkValidator),
  chainEpoch: v.optional(v.string()),
  /** Core `article_id`, 32 bytes, lowercase hex. */
  chainArticleKey: v.optional(v.string()),
  /** The Core author that minted; the royalty receiver (I-20). */
  minterAddress: v.optional(v.string()),
  /** `ArticleNftMinted.total_at_mint`: the Core total of the threshold token. */
  totalAtMintBaseUnits: v.optional(v.string()),
  /** RPC id of the `article_nft_minted` event. */
  mintEventId: v.optional(v.string()),
  mintLedger: v.optional(v.number()),
  /**
   * RPC id of the newest event that set `ownerAddress`. An older event never
   * changes ownership, so replayed or reordered events are safe.
   */
  ownerEventId: v.optional(v.string()),
}

/** Extra `nftTransfers` fields for v2 rows. */
export const nftTransferChainFields = {
  contractVersion: v.optional(v.union(v.literal('v1'), v.literal('v2'))),
  network: v.optional(networkValidator),
  chainEpoch: v.optional(v.string()),
  /** RPC id of the OpenZeppelin `transfer` event; one row per event. */
  chainEventId: v.optional(v.string()),
  ledger: v.optional(v.number()),
}

/**
 * The values an NFT submission must produce, fixed at prepare. Verification
 * compares the transaction's NFT event with them.
 */
export const expectedNftValidator = v.union(
  v.object({
    action: v.literal('mint'),
    /** Core `article_id`, lowercase hex. */
    articleKey: v.string(),
    articleId: v.id('articles'),
    /** The Core author: transaction source, authorising address and recipient. */
    signer: v.string(),
  }),
  v.object({
    action: v.literal('transfer'),
    nftId: v.id('articleNFTs'),
    tokenId: v.number(),
    /** The owner: transaction source and authorising address. */
    signer: v.string(),
    from: v.string(),
    to: v.string(),
    /** Set when `to` was resolved from a QuillTip user. */
    toUserId: v.optional(v.id('users')),
  })
)
