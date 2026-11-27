import { tipXlmPresetValidator } from './lib/articleTipExpectation'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'
import { nftChainFields, nftTransferChainFields } from './lib/chain/nftSchema'
import { chainTables, tabTables, tipChainFields } from './lib/chain/schema'
import { lifetimeTotalsFields } from './lib/lifetimeTotalsFields'

export default defineSchema({
  ...authTables,

  // Users table
  users: defineTable({
    // Unique identifiers
    email: v.string(),
    username: v.string(),
    // Lowercase copy of username for case-insensitive uniqueness and lookup.
    usernameLower: v.optional(v.string()),

    // Profile
    name: v.optional(v.string()),
    bio: v.optional(v.string()),
    avatar: v.optional(v.string()),

    // Authentication
    hashedPassword: v.optional(v.string()),
    // Set by Convex Auth when an emailed code is verified (password reset).
    emailVerificationTime: v.optional(v.number()),

    // Stellar integration (optional, can be null to explicitly clear).
    // An address counts for tips and earnings only once the user has proved
    // control of it (convex/walletLink.ts): stellarAddressVerifiedAt is set and
    // stellarAddressVerifiedNetwork is the backend's network passphrase.
    // Addresses linked before proof was required have neither field.
    stellarAddress: v.optional(v.union(v.string(), v.null())),
    stellarAddressVerifiedAt: v.optional(v.number()),
    stellarAddressVerifiedNetwork: v.optional(v.string()),

    // Onboarding
    onboardingCompleted: v.optional(v.boolean()),

    // Stats (denormalized for performance)
    articleCount: v.optional(v.number()),
    highlightCount: v.optional(v.number()),
    tipsSentCount: v.optional(v.number()),
    tipsReceivedCount: v.optional(v.number()),
    nftsCreated: v.optional(v.number()),
    nftsOwned: v.optional(v.number()),

    // Accounts used for QA and demos. Missing means false. Set only by
    // internal functions; public metrics can exclude or label them.
    isTestAccount: v.optional(v.boolean()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_email', ['email'])
    .index('by_username', ['username'])
    .index('by_username_lower', ['usernameLower'])
    .index('by_test_account', ['isTestAccount'])
    // Resolves an on-chain recipient address to a Quilltip user (earnings).
    .index('by_stellar_address', ['stellarAddress']),

  // Single-use proofs of wallet control (convex/walletLink.ts).
  walletChallenges: defineTable({
    userId: v.id('users'),
    address: v.string(),
    networkPassphrase: v.string(),
    origin: v.string(),
    nonce: v.string(),
    issuedAt: v.number(),
    expiresAt: v.number(),
    // Set on the first verification attempt, successful or not.
    usedAt: v.optional(v.number()),
    outcome: v.optional(v.string()),
  })
    .index('by_user_issued', ['userId', 'issuedAt'])
    .index('by_expires', ['expiresAt']),

  // Handles a writer used before. Each stays reserved for that writer and its
  // URLs redirect to the writer's current handle.
  usernameHistory: defineTable({
    userId: v.id('users'),
    username: v.string(),
    usernameLower: v.string(),
    retiredAt: v.number(),
  })
    .index('by_username_lower', ['usernameLower'])
    .index('by_user', ['userId']),

  // Articles table
  articles: defineTable({
    // Identification
    slug: v.string(),
    title: v.string(),

    // Content
    content: v.any(), // TipTap JSON content
    excerpt: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    /** Author-only planning notes; never exposed on public article reads */
    writerNotes: v.optional(v.string()),

    // Publishing
    published: v.boolean(),
    publishedAt: v.optional(v.number()),

    // Author relationship
    authorId: v.id('users'),

    // Denormalized author data for performance
    authorUsername: v.string(),
    authorName: v.optional(v.string()),
    authorAvatar: v.optional(v.string()),

    // Tags
    tags: v.optional(v.array(v.string())),

    // Denormalized for full-text listing (title, excerpt, body snippet, tags); see search_listing
    searchContent: v.optional(v.string()),

    // Stats (denormalized)
    viewCount: v.optional(v.number()),
    highlightCount: v.optional(v.number()),
    tipCount: v.optional(v.number()),
    totalTipsUsd: v.optional(v.number()),

    // NFT reference
    hasNft: v.optional(v.boolean()),
    nftId: v.optional(v.id('articleNFTs')),

    // Computed
    readTime: v.optional(v.number()),

    // Arweave permanent storage
    arweaveTxId: v.optional(v.string()),
    arweaveUrl: v.optional(v.string()),
    arweaveStatus: v.optional(v.string()), // pending|uploaded|verified|failed
    arweaveTimestamp: v.optional(v.number()),
    arweaveVerifyAttempts: v.optional(v.number()), // Track verification retries
    arweaveErrorMessage: v.optional(v.string()), // Store error details
    // Content anchor. With contentHashSchema 'quilltip-article-v1', contentHash
    // is SHA-256 of canonicalArticleBytes (convex/lib/chain/ids.ts) at
    // contentVersion. Without it, contentHash is a legacy hash of an earlier
    // upload body and is kept unchanged.
    contentVersion: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    contentHashSchema: v.optional(v.string()),
    // The contentHash the Arweave upload body reproduces. Registration passes
    // arweaveTxId on chain only when this equals contentHash.
    arweaveContentHash: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_author', ['authorId'])
    .index('by_author_updated_at', ['authorId', 'updatedAt'])
    .index('by_published', ['published'])
    .index('by_author_published', ['authorId', 'published']) // Composite for author's published articles
    .index('by_author_published_updated_at', [
      'authorId',
      'published',
      'updatedAt',
    ])
    .index('by_published_date', ['published', 'publishedAt']) // For listing by date
    .searchIndex('search_listing', {
      searchField: 'searchContent',
      filterFields: ['published', 'authorUsername'],
    }),

  readingRoomArticles: defineTable({
    articleId: v.id('articles'),
    authorId: v.id('users'),
    authorName: v.optional(v.string()),
    authorUsername: v.string(),
    title: v.string(),
    grams: v.string(),
    oversized: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
    publishedAt: v.optional(v.number()),
    createdAt: v.number(),
    tipCount: v.optional(v.number()),
    highlightCount: v.optional(v.number()),
  })
    .index('by_article', ['articleId'])
    .index('by_author', ['authorId'])
    .index('by_oversized', ['oversized'])
    .searchIndex('by_grams', {
      searchField: 'grams',
      filterFields: ['authorId'],
    }),

  readingRoomWriters: defineTable({
    authorId: v.id('users'),
    grams: v.string(),
    oversized: v.optional(v.boolean()),
  })
    .index('by_author', ['authorId'])
    .index('by_oversized', ['oversized'])
    .searchIndex('by_grams', { searchField: 'grams', filterFields: [] }),

  readingRoomIndexState: defineTable({
    version: v.literal(1),
    cursor: v.union(v.string(), v.null()),
    complete: v.boolean(),
  }).index('by_version', ['version']),

  // One row per (article, tag) for published articles; used for indexed tag listing
  articleTagLinks: defineTable({
    articleId: v.id('articles'),
    tag: v.string(),
    authorId: v.id('users'),
    publishedAt: v.number(),
  })
    .index('by_article', ['articleId'])
    .index('by_article_tag', ['articleId', 'tag'])
    .index('by_tag_publishedAt', ['tag', 'publishedAt'])
    .index('by_author_tag_publishedAt', ['authorId', 'tag', 'publishedAt']),

  // Tags table
  tags: defineTable({
    name: v.string(),
    slug: v.string(),

    // Stats
    articleCount: v.optional(v.number()),

    // Display
    description: v.optional(v.string()),
    color: v.optional(v.string()),
  })
    .index('by_name', ['name'])
    .index('by_slug', ['slug']),

  // Highlights table
  highlights: defineTable({
    // References
    articleId: v.id('articles'),
    userId: v.id('users'),

    // Denormalized data for performance
    articleTitle: v.string(),
    articleSlug: v.string(),
    articleAuthor: v.string(),
    userName: v.optional(v.string()),
    userAvatar: v.optional(v.string()),

    // Text selection data
    text: v.string(),
    startOffset: v.number(),
    endOffset: v.number(),
    startContainerPath: v.string(),
    endContainerPath: v.string(),

    // Unique identifier (SHA256 hash) for linking with tips
    highlightId: v.string(),

    // Metadata
    color: v.optional(v.string()),
    note: v.optional(v.string()),
    isPublic: v.boolean(),
    // Personal removal is reversible; passage identity and financial links remain.
    removedAt: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_article', ['articleId'])
    .index('by_user', ['userId'])
    .index('by_article_public', ['articleId', 'isPublic'])
    .index('by_article_user_public', ['articleId', 'userId', 'isPublic'])
    .index('by_highlight_id', ['highlightId'])
    .index('by_user_public', ['userId', 'isPublic']) // For user's public highlights
    .index('by_article_public_removed', ['articleId', 'isPublic', 'removedAt'])
    .index('by_article_user_public_removed', [
      'articleId',
      'userId',
      'isPublic',
      'removedAt',
    ])
    .index('by_user_removed', ['userId', 'removedAt'])
    .index('by_user_public_removed', ['userId', 'isPublic', 'removedAt'])
    .index('by_article_passage_user', ['articleId', 'highlightId', 'userId'])
    .index('by_article_passage_public_removed', [
      'articleId',
      'highlightId',
      'isPublic',
      'removedAt',
    ]),

  passageAppreciations: defineTable({
    articleId: v.id('articles'),
    highlightId: v.string(),
    userId: v.id('users'),
  }).index('by_article_passage_user', ['articleId', 'highlightId', 'userId']),

  // Private, pre-wallet expectations for whole-article tips. These rows never
  // contribute to public totals or histories; a normal tip row is created
  // only after a Stellar transaction hash is available.
  articleTipIntents: defineTable({
    articleId: v.id('articles'),
    tipperId: v.id('users'),
    authorId: v.id('users'),
    articleTitle: v.string(),
    articleSlug: v.string(),
    tipperName: v.optional(v.string()),
    tipperAvatar: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorAvatar: v.optional(v.string()),
    amountUsd: v.number(),
    amountCents: v.number(),
    message: v.optional(v.string()),
    expectedSourceAccount: v.string(),
    expectedDestinationAccount: v.string(),
    expectedArticleSymbol: v.string(),
    amountXlm: v.optional(tipXlmPresetValidator),
    expectedAmountStroops: v.string(),
    expectedContractId: v.optional(v.string()),
    expectedMinTime: v.optional(v.string()),
    expectedMaxTime: v.optional(v.string()),
    expectedMemo: v.optional(v.string()),
    expectedStellarNetwork: v.optional(
      v.union(v.literal('TESTNET'), v.literal('MAINNET'))
    ),
    quotePriceUsd: v.number(),
    quoteSource: v.string(),
    quoteFetchedAt: v.number(),
    tipId: v.optional(v.id('tips')),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_tipper', ['tipperId'])
    .index('by_tipper_expiry', ['tipperId', 'expiresAt'])
    .index('by_expiry', ['expiresAt'])
    .index('by_tip_expiry', ['tipId', 'expiresAt']),

  // Private, server-owned expectations for passage-level tips. Wallet clients
  // receive only the trusted transaction-build fields and cannot overwrite
  // the selection or payment terms when they submit a transaction receipt.
  highlightTipIntents: defineTable({
    articleId: v.id('articles'),
    tipperId: v.id('users'),
    authorId: v.id('users'),
    articleTitle: v.string(),
    articleSlug: v.string(),
    tipperName: v.optional(v.string()),
    tipperAvatar: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorAvatar: v.optional(v.string()),
    highlightText: v.string(),
    startOffset: v.number(),
    endOffset: v.number(),
    startContainerPath: v.optional(v.string()),
    endContainerPath: v.optional(v.string()),
    amountUsd: v.number(),
    amountCents: v.number(),
    message: v.optional(v.string()),
    expectedSourceAccount: v.string(),
    expectedDestinationAccount: v.string(),
    expectedHighlightId: v.string(),
    expectedArticleSymbol: v.string(),
    amountXlm: v.optional(tipXlmPresetValidator),
    expectedAmountStroops: v.string(),
    expectedContractId: v.string(),
    expectedFunction: v.optional(v.string()),
    expectedMinTime: v.string(),
    expectedMaxTime: v.string(),
    expectedStellarNetwork: v.union(v.literal('TESTNET'), v.literal('MAINNET')),
    quotePriceUsd: v.number(),
    quoteSource: v.string(),
    quoteFetchedAt: v.number(),
    legacyCompatibility: v.optional(v.boolean()),
    tipId: v.optional(v.id('highlightTips')),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_tipper_expiry', ['tipperId', 'expiresAt'])
    .index('by_expiry', ['expiresAt'])
    .index('by_tip', ['tipId'])
    .index('by_tip_expiry', ['tipId', 'expiresAt']),

  // Tips table
  tips: defineTable({
    // References
    articleId: v.id('articles'),
    tipperId: v.id('users'),
    authorId: v.id('users'),

    // Denormalized data
    articleTitle: v.string(),
    articleSlug: v.string(),
    tipperName: v.optional(v.string()),
    tipperAvatar: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorAvatar: v.optional(v.string()),

    // Tip details
    amountUsd: v.number(),
    amountCents: v.number(),
    message: v.optional(v.string()),

    // Blockchain data
    stellarTxId: v.optional(v.string()),
    stellarNetwork: v.optional(v.string()), // TESTNET or MAINNET
    stellarLedger: v.optional(v.number()), // Ledger number
    stellarFeeCharged: v.optional(v.string()), // Network fee in XLM
    stellarMemo: v.optional(v.string()), // Transaction memo
    stellarSourceAccount: v.optional(v.string()), // Sender's Stellar address
    stellarDestinationAccount: v.optional(v.string()), // Receiver's Stellar address
    stellarAmountXlm: v.optional(v.string()), // Amount in XLM
    contractTipId: v.optional(v.string()),

    // Immutable server-owned expectation copied from articleTipIntents.
    articleTipIntentId: v.optional(v.id('articleTipIntents')),
    expectedSourceAccount: v.optional(v.string()),
    expectedDestinationAccount: v.optional(v.string()),
    expectedArticleSymbol: v.optional(v.string()),
    expectedAmountStroops: v.optional(v.string()),
    expectedContractId: v.optional(v.string()),
    expectedMinTime: v.optional(v.string()),
    expectedMaxTime: v.optional(v.string()),
    expectedMemo: v.optional(v.string()),
    quotePriceUsd: v.optional(v.number()),
    quoteSource: v.optional(v.string()),
    quoteFetchedAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    verificationRequestedAt: v.optional(v.number()),

    // Status
    status: v.string(), // PENDING, CONFIRMING, CONFIRMED, FAILED, FRAUDULENT, UNVERIFIED
    failureReason: v.optional(v.string()), // Error message if failed
    platformFee: v.optional(v.number()),
    authorShare: v.optional(v.number()),

    // Payments v2 fields (optional; v1 rows leave them unset)
    ...tipChainFields,
    // Set once the earnings sync has handled this v2 row. A row it did not
    // credit carries `earningsSkipReason` (for example `needs_review`).
    earningsAppliedAt: v.optional(v.number()),
    earningsSkipReason: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    processedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_article', ['articleId'])
    .index('by_tipper', ['tipperId'])
    .index('by_author', ['authorId'])
    .index('by_status', ['status'])
    .index('by_status_created', ['status', 'createdAt']) // For paginated status queries
    .index('by_status_updated', ['status', 'updatedAt']) // For stuck verification recovery
    // v2 paid rows not yet handled by the earnings sync.
    .index('by_version_status_earnings', [
      'contractVersion',
      'status',
      'earningsAppliedAt',
    ])
    .index('by_article_tip_intent', ['articleTipIntentId'])
    // Not unique for v2: batch rows share one hash.
    .index('by_stellar_tx', ['stellarTxId'])
    .index('by_client_ref', ['clientRef'])
    // Rows flagged for operator review (convex/chain/review.ts).
    .index('by_needs_review', ['needsReview', 'updatedAt'])
    .index('by_request', ['requestId']),

  // Highlight Tips table (NEW - granular tipping)
  highlightTips: defineTable({
    // Core references
    highlightId: v.string(), // SHA256 hash stored in Stellar memo
    articleId: v.id('articles'),
    tipperId: v.id('users'),
    authorId: v.id('users'),

    // Denormalized data for performance
    highlightText: v.string(), // The actual text that was tipped
    articleTitle: v.string(),
    articleSlug: v.string(),
    tipperName: v.optional(v.string()),
    tipperAvatar: v.optional(v.string()),
    authorName: v.optional(v.string()),
    authorAvatar: v.optional(v.string()),

    // Tip details
    amountUsd: v.number(),
    amountCents: v.number(),
    message: v.optional(v.string()),

    // Stellar transaction data. Optional because v2 batch and tab rows have
    // no value at insert.
    stellarTxId: v.optional(v.string()),
    stellarNetwork: v.optional(v.string()), // TESTNET or MAINNET
    stellarMemo: v.optional(v.string()), // Highlight ID stored in memo
    stellarLedger: v.optional(v.number()),
    stellarFeeCharged: v.optional(v.string()),
    stellarSourceAccount: v.optional(v.string()),
    stellarDestinationAccount: v.optional(v.string()),
    stellarAmountXlm: v.optional(v.string()),
    contractTipId: v.optional(v.string()),

    // Immutable server-owned expectation copied from highlightTipIntents.
    // Optional fields keep legacy create rows readable during UI migration.
    highlightTipIntentId: v.optional(v.id('highlightTipIntents')),
    expectedSourceAccount: v.optional(v.string()),
    expectedDestinationAccount: v.optional(v.string()),
    expectedHighlightId: v.optional(v.string()),
    expectedArticleSymbol: v.optional(v.string()),
    expectedAmountStroops: v.optional(v.string()),
    expectedContractId: v.optional(v.string()),
    expectedFunction: v.optional(v.string()),
    expectedMinTime: v.optional(v.string()),
    expectedMaxTime: v.optional(v.string()),
    quotePriceUsd: v.optional(v.number()),
    quoteSource: v.optional(v.string()),
    quoteFetchedAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    verificationGeneration: v.optional(v.number()),
    verificationRequestedAt: v.optional(v.number()),

    // Position data (for heatmap visualization)
    startOffset: v.number(),
    endOffset: v.number(),
    startContainerPath: v.optional(v.string()),
    endContainerPath: v.optional(v.string()),

    // Status
    status: v.string(), // PENDING, CONFIRMED, FAILED, UNVERIFIED
    failureReason: v.optional(v.string()),
    // Set when verification confirms the tip but could not fully validate the
    // claimed USD amount — e.g. XLM price oracle was unreachable, or the
    // on-chain amount diverged from the claim beyond tolerance. CONFIRMED
    // tips with this flag are trusted for the tipper's history but should
    // be surfaced for audit rather than silently included in earnings.
    amountUsdSuspicious: v.optional(v.boolean()),
    amountUsdSuspicionReason: v.optional(v.string()),
    platformFee: v.optional(v.number()),
    authorShare: v.optional(v.number()),

    // Payments v2 fields (optional; v1 rows leave them unset)
    ...tipChainFields,
    // Set once the earnings sync has handled this v2 row. A row it did not
    // credit carries `earningsSkipReason` (for example `needs_review`).
    earningsAppliedAt: v.optional(v.number()),
    earningsSkipReason: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    processedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_highlight', ['highlightId'])
    .index('by_article', ['articleId'])
    .index('by_tipper', ['tipperId'])
    .index('by_author', ['authorId'])
    .index('by_status', ['status'])
    .index('by_status_created', ['status', 'createdAt']) // For paginated status queries
    .index('by_status_updated', ['status', 'updatedAt']) // For stuck verification recovery
    // v2 paid rows not yet handled by the earnings sync.
    .index('by_version_status_earnings', [
      'contractVersion',
      'status',
      'earningsAppliedAt',
    ])
    .index('by_highlight_tip_intent', ['highlightTipIntentId'])
    .index('by_stellar_tx', ['stellarTxId'])
    .index('by_client_ref', ['clientRef'])
    // Rows flagged for operator review (convex/chain/review.ts).
    .index('by_needs_review', ['needsReview', 'updatedAt'])
    .index('by_request', ['requestId']),

  // Author Earnings table
  authorEarnings: defineTable({
    // Relationship
    userId: v.id('users'),

    // Earnings data
    totalEarnedUsd: v.number(),
    totalEarnedCents: v.number(),
    availableBalanceUsd: v.number(),
    availableBalanceCents: v.number(),
    pendingBalanceUsd: v.number(),
    pendingBalanceCents: v.number(),
    withdrawnUsd: v.number(),
    withdrawnCents: v.number(),

    // Stats
    tipCount: v.number(),
    lastTipAt: v.optional(v.number()),
    lastWithdrawalAt: v.optional(v.number()),

    // Monthly breakdown (denormalized)
    monthlyEarnings: v.optional(v.any()),

    // Payments v2 (docs/architecture/v2/06-app-integration.md, section 6.2).
    // Decimal strings of base units, keyed by token contract ID.
    earnedBaseUnits: v.optional(v.record(v.string(), v.string())),
    pendingBaseUnits: v.optional(v.record(v.string(), v.string())),
    collectedBaseUnits: v.optional(v.record(v.string(), v.string())),
    // The v2 part of tipCount and totalEarnedCents.
    v2TipCount: v.optional(v.number()),
    v2EarnedCents: v.optional(v.number()),

    // Lifetime totals per recipient for the writer's earnings summary
    // (#552, convex/lib/lifetimeEarnings.ts), and the progress of a row's
    // rebuild from its history (convex/earningsTotalsBackfill.ts).
    ...lifetimeTotalsFields,

    // Top articles (denormalized)
    topArticles: v.optional(
      v.array(
        v.object({
          articleId: v.id('articles'),
          title: v.string(),
          earnings: v.number(),
          tipCount: v.number(),
        })
      )
    ),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_lifetime_totals', ['lifetimeTotalsAt', 'lifetimeRebuildTurnAt']),

  // Article NFTs table
  articleNFTs: defineTable({
    // Article reference
    articleId: v.id('articles'),

    // NFT data. v2 rows: `tokenId` is the contract's u32 token ID in decimal.
    tokenId: v.string(),
    contractAddress: v.optional(v.string()),
    metadataUrl: v.string(),

    // Ownership. For v2 rows `ownerAddress` is the source of truth and
    // `currentOwner` is set only when it resolves to a Quilltip user. Only
    // the NFT event handlers (convex/lib/chain/nftEventHandlers.ts) write
    // ownership of a v2 row.
    // v2 rows: the user whose verified address minted, when there is one.
    mintedBy: v.optional(v.id('users')),
    currentOwner: v.optional(v.id('users')),
    ownerAddress: v.optional(v.string()),

    // Payments v2
    contractVersion: v.optional(v.union(v.literal('v1'), v.literal('v2'))),
    txHash: v.optional(v.string()),
    chainVerifiedAt: v.optional(v.number()),
    ...nftChainFields,

    // Minting criteria (v1 rows, in USD cents; v2 rows use the base-unit
    // fields in `nftChainFields`)
    tipThreshold: v.optional(v.number()),
    totalTipsAtMint: v.optional(v.number()),

    // Timestamps
    mintedAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_token_id', ['tokenId'])
    .index('by_article', ['articleId'])
    .index('by_current_owner', ['currentOwner'])
    .index('by_minted_by', ['mintedBy'])
    .index('by_owner_address', ['ownerAddress']),

  // NFT Transfers table
  nftTransfers: defineTable({
    // NFT reference
    nftId: v.id('articleNFTs'),

    // Transfer parties. v2 rows: the addresses come from the verified
    // `transfer` event; the user IDs are set only for Quilltip users.
    fromUserId: v.optional(v.id('users')),
    toUserId: v.optional(v.id('users')),
    fromAddress: v.optional(v.string()),
    toAddress: v.optional(v.string()),

    // Transaction data. Required for v2 rows (checked in
    // convex/lib/chain/nftStore.ts).
    transactionId: v.optional(v.string()),
    ...nftTransferChainFields,

    // Timestamp
    transferredAt: v.number(),
  })
    .index('by_nft', ['nftId'])
    .index('by_from_user', ['fromUserId'])
    .index('by_to_user', ['toUserId'])
    .index('by_chain_event', ['chainEventId']),

  // Withdrawals table
  withdrawals: defineTable({
    // User reference
    userId: v.id('users'),

    // Amount
    amountUsd: v.number(),
    amountCents: v.number(),

    // Destination
    stellarAddress: v.string(),

    // Status
    status: v.string(), // PENDING, PROCESSING, COMPLETED, FAILED
    failureReason: v.optional(v.string()),

    // Transaction data
    stellarTxId: v.optional(v.string()),
    stellarNetwork: v.optional(v.string()), // TESTNET or MAINNET
    stellarLedger: v.optional(v.number()),
    stellarFeeCharged: v.optional(v.string()),
    stellarAmountXlm: v.optional(v.string()),

    // Timestamps
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_status', ['status']),

  // File uploads table
  uploadTickets: defineTable({
    tokenHash: v.string(),
    userId: v.id('users'),
    expiresAt: v.number(),
  })
    .index('by_hash', ['tokenHash'])
    .index('by_user', ['userId']),

  uploadOwners: defineTable({
    storageId: v.id('_storage'),
    fileType: v.string(),
    userId: v.id('users'),
    url: v.optional(v.string()),
    referencesTracked: v.optional(v.boolean()),
  })
    .index('by_storage', ['storageId'])
    .index('by_url', ['url']),

  uploadReferences: defineTable({
    storageId: v.id('_storage'),
    articleId: v.optional(v.id('articles')),
    userId: v.optional(v.id('users')),
  })
    .index('by_storage', ['storageId'])
    .index('by_article_storage', ['articleId', 'storageId'])
    .index('by_user_storage', ['userId', 'storageId']),

  fileUploads: defineTable({
    // Storage reference
    storageId: v.id('_storage'),

    // File metadata
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),

    // Upload context
    uploadType: v.union(
      v.literal('avatar'),
      v.literal('article_image'),
      v.literal('cover_image'),
      v.literal('article_cover')
    ),
    uploadedBy: v.id('users'),
    articleId: v.optional(v.id('articles')),

    // Timestamp
    createdAt: v.number(),
  })
    .index('by_storage', ['storageId'])
    .index('by_user', ['uploadedBy'])
    .index('by_article', ['articleId'])
    .index('by_type', ['uploadType']),

  // Server-side XLM/USD price cache. Refreshed by a cron job every 5 minutes
  // so the browser does not have to call public price oracles directly —
  // collapses the CSP allowlist (no per-oracle hosts) and amortises the
  // oracle hits across all users to one fetch per refresh interval.
  // Modeled as a singleton row: queries always read .first(), the refresh
  // mutation patches if a row exists or inserts otherwise.
  xlmPriceCache: defineTable({
    priceUsd: v.number(),
    source: v.string(), // 'CoinGecko', 'CoinCap', 'Binance', 'Kraken'
    fetchedAt: v.number(),
  }),

  // Waitlist table. Status flow: pending -> invited -> joined. A row is
  // marked joined when an account is created with the same email.
  waitlist: defineTable({
    // Lowercased, trimmed email
    email: v.string(),
    name: v.optional(v.string()),
    // What the person wants to read or write about (optional, short)
    interest: v.optional(v.string()),

    // Status tracking
    status: v.optional(v.string()), // "pending", "invited", "joined"

    // Metadata
    source: v.optional(v.string()), // "waitlist_page", "referral", etc.
    invitedAt: v.optional(v.number()),
    joinedAt: v.optional(v.number()),
    userId: v.optional(v.id('users')),

    // Timestamps
    createdAt: v.number(),
  })
    .index('by_email', ['email'])
    .index('by_status', ['status']),

  // In-product feedback from signed-in readers and writers.
  feedback: defineTable({
    userId: v.id('users'),
    category: v.union(
      v.literal('bug'),
      v.literal('idea'),
      v.literal('question'),
      v.literal('other')
    ),
    message: v.string(),
    // Path the person was on, without query string
    pagePath: v.optional(v.string()),
    status: v.union(v.literal('new'), v.literal('reviewed')),
    createdAt: v.number(),
  })
    .index('by_user_created', ['userId', 'createdAt'])
    .index('by_status_created', ['status', 'createdAt']),

  // Fixed-window counters for rate limiting public and signed-in writes.
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index('by_key', ['key']),

  // Payments v2 chain layer (docs/architecture/v2/06-app-integration.md, 6.2)
  ...chainTables,
  ...tabTables,
})
