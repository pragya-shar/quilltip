/**
 * Payments v2 schema pieces (docs/architecture/v2/06-app-integration.md,
 * section 6.2). `convex/schema.ts` spreads these into the existing tables and
 * the new chain tables.
 *
 * Conventions: every new row carries `network` and `chainEpoch`; amounts are
 * decimal strings of base units (stroops for the native token).
 * The tab tables (`tabAccounts`, `tabSessionKeys`, `tabReceipts`,
 * `tabVouchers`, `tabSettlements`) are added with the tab ledger.
 */
import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const chainNetworkValidator = v.union(
  v.literal('TESTNET'),
  v.literal('MAINNET')
)

/** States of a direct or batch tip, and of a chain submission. */
export const CHAIN_RECORD_STATUSES = [
  'PREPARED',
  'SUBMITTED',
  'CONFIRMED',
  'MISMATCH',
  'FAILED',
  'EXPIRED',
] as const
export type ChainRecordStatus = (typeof CHAIN_RECORD_STATUSES)[number]

export const chainRecordStatusValidator = v.union(
  v.literal('PREPARED'),
  v.literal('SUBMITTED'),
  v.literal('CONFIRMED'),
  v.literal('MISMATCH'),
  v.literal('FAILED'),
  v.literal('EXPIRED')
)

export const chainSubmissionKindValidator = v.union(
  v.literal('tip'),
  v.literal('tip_batch'),
  v.literal('register'),
  v.literal('content_update'),
  v.literal('author_propose'),
  v.literal('author_accept'),
  v.literal('tab'),
  v.literal('claim'),
  v.literal('nft')
)

/** A row a chain submission links to. */
export const chainRelatedValidator = v.union(
  v.object({ table: v.literal('tips'), id: v.id('tips') }),
  v.object({ table: v.literal('highlightTips'), id: v.id('highlightTips') }),
  v.object({ table: v.literal('chainArticles'), id: v.id('chainArticles') })
)

/**
 * Optional fields added to `tips` and `highlightTips`. v1 rows leave them
 * unset (the backfill sets `contractVersion: 'v1'`).
 */
export const tipChainFields = {
  contractVersion: v.optional(v.union(v.literal('v1'), v.literal('v2'))),
  channel: v.optional(
    v.union(v.literal('direct'), v.literal('batch'), v.literal('tab'))
  ),
  /** 16-byte idempotency key, lowercase hex. */
  clientRef: v.optional(v.string()),
  tokenContractId: v.optional(v.string()),
  grossBaseUnits: v.optional(v.string()),
  feeBaseUnits: v.optional(v.string()),
  netBaseUnits: v.optional(v.string()),
  onChainAuthorAddress: v.optional(v.string()),
  chainEventId: v.optional(v.string()),
  tabReceiptId: v.optional(v.string()),
  requestId: v.optional(v.string()),
  submissionId: v.optional(v.id('chainSubmissions')),
  // Expected payment fields, set at prepare and never changed.
  /** `article_id`, 32 bytes, lowercase hex. */
  chainArticleKey: v.optional(v.string()),
  /** `highlight_id`, 32 bytes, lowercase hex (highlight tips only). */
  chainHighlightKey: v.optional(v.string()),
  expectedTipperAddress: v.optional(v.string()),
  expectedAuthorAddress: v.optional(v.string()),
  chainEpoch: v.optional(v.string()),
  /** Unix seconds; the transaction's upper time bound. */
  maxTime: v.optional(v.number()),
  /** Latest ledger known at prepare; the transaction must not be older. */
  createdLedger: v.optional(v.number()),
  // Verification results.
  mismatchReason: v.optional(v.string()),
  needsReview: v.optional(v.boolean()),
  chainContentHash: v.optional(v.string()),
  chainContentVersion: v.optional(v.number()),
  // Values decoded from the on-chain `Tipped` event, kept next to the
  // expected values above. `onChainAuthorAddress`, `feeBaseUnits` and
  // `netBaseUnits` are also decoded values.
  onChainTipperAddress: v.optional(v.string()),
  onChainTokenContractId: v.optional(v.string()),
  onChainGrossBaseUnits: v.optional(v.string()),
  onChainArticleKey: v.optional(v.string()),
  /** Null when the event carried no highlight. */
  onChainHighlightKey: v.optional(v.union(v.string(), v.null())),
  onChainClientRef: v.optional(v.string()),
  // Operator decision on a row flagged for review.
  reviewResolution: v.optional(
    v.union(v.literal('credit_decoded'), v.literal('no_credit'))
  ),
  reviewResolvedAt: v.optional(v.number()),
  reviewNote: v.optional(v.string()),
}

export const chainTables = {
  chainConfig: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    coreContractId: v.optional(v.string()),
    tabContractId: v.optional(v.string()),
    nftContractId: v.optional(v.string()),
    tokenContractId: v.optional(v.string()),
    minTip: v.optional(v.string()),
    feeBps: v.optional(v.number()),
    nftThreshold: v.optional(v.string()),
    paused: v.object({
      core: v.optional(v.boolean()),
      tab: v.optional(v.boolean()),
      nft: v.optional(v.boolean()),
    }),
    refreshedAt: v.number(),
    lastError: v.optional(v.string()),
  }).index('by_network', ['network']),

  chainArticles: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    articleId: v.id('articles'),
    articleKey: v.string(),
    authorAddress: v.string(),
    pendingAuthor: v.optional(v.string()),
    contentHash: v.string(),
    arweaveId: v.optional(v.string()),
    contentVersion: v.number(),
    splits: v.array(v.object({ recipient: v.string(), bps: v.number() })),
    /** Gross cumulative total per token contract ID, from `Tipped.total_after`. */
    totals: v.record(v.string(), v.string()),
    status: v.union(
      v.literal('PREPARED'),
      v.literal('SUBMITTED'),
      v.literal('REGISTERED'),
      v.literal('FAILED')
    ),
    registeredLedger: v.optional(v.number()),
    txHash: v.optional(v.string()),
    /** RPC id of the last event applied; older events are ignored. */
    lastEventId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_article', ['articleId'])
    .index('by_article_key', ['articleKey'])
    .index('by_author_address', ['authorAddress']),

  chainSubmissions: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    kind: chainSubmissionKindValidator,
    userId: v.optional(v.id('users')),
    contractId: v.string(),
    /** Client idempotency key for the prepare call. */
    requestId: v.string(),
    clientRefs: v.array(v.string()),
    txHash: v.optional(v.string()),
    /** Unix seconds; the transaction's upper time bound. */
    maxTime: v.number(),
    createdLedger: v.optional(v.number()),
    status: chainRecordStatusValidator,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    mismatchReason: v.optional(v.string()),
    needsReview: v.optional(v.boolean()),
    related: v.array(chainRelatedValidator),
    ledger: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_request', ['requestId'])
    .index('by_tx', ['txHash'])
    .index('by_status_updated', ['status', 'updatedAt']),

  chainEvents: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    eventId: v.string(),
    contractId: v.string(),
    ledger: v.number(),
    ledgerCloseTime: v.number(),
    txHash: v.string(),
    type: v.string(),
    topics: v.array(v.any()),
    data: v.any(),
    /** `Tipped.client_ref` in hex, so rule (b) can find a record's event. */
    clientRef: v.optional(v.string()),
    handled: v.union(
      v.literal('pending'),
      v.literal('done'),
      v.literal('orphan'),
      v.literal('error')
    ),
  })
    .index('by_event_id', ['eventId'])
    .index('by_type_ledger', ['type', 'ledger'])
    .index('by_tx', ['txHash'])
    .index('by_handled', ['handled'])
    .index('by_client_ref', ['clientRef']),

  chainCursor: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    cursor: v.optional(v.string()),
    lastLedger: v.number(),
    /** Unix seconds. */
    lastLedgerCloseTime: v.number(),
    latestLedger: v.number(),
    oldestLedger: v.number(),
    lagLedgers: v.number(),
    status: v.union(
      v.literal('OK'),
      v.literal('LAGGING'),
      v.literal('BEHIND_RETENTION'),
      // The ledger sequence dropped or a contract instance is missing. The
      // indexer stops until an operator starts a new epoch or replays.
      v.literal('RESET_DETECTED')
    ),
    /** First ledger to read when `cursor` is unset (start or replay). */
    startLedger: v.optional(v.number()),
    /** Why the indexer stopped, for `BEHIND_RETENTION` and `RESET_DETECTED`. */
    statusReason: v.optional(v.string()),
    lastRunAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_network', ['network']),

  chainLeases: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    name: v.string(),
    holder: v.string(),
    expiresAt: v.number(),
  }).index('by_name', ['name']),
}
