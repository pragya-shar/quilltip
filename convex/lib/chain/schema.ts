/**
 * Payments v2 schema pieces (docs/architecture/v2/06-app-integration.md,
 * section 6.2). `convex/schema.ts` spreads these into the existing tables and
 * the new chain tables.
 *
 * Conventions: every new row carries `network` and `chainEpoch`; amounts are
 * decimal strings of base units (stroops for the native token).
 * `tabTables` holds the tab ledger (`tabAccounts`, `tabSessionKeys`,
 * `tabReceipts`, `tabVouchers`, `tabSettlements`).
 */
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { expectedNftValidator } from './nftSchema'

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

/**
 * Expected on-chain values of an article submission (register, content
 * update, author change), fixed at prepare. Verification compares the
 * transaction's Core event with them. Bytes are lowercase hex.
 */
export const expectedArticleValidator = v.object({
  articleKey: v.string(),
  /** The address that signs: the transaction source and the authorising address. */
  signer: v.string(),
  author: v.optional(v.string()),
  articleRef: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  arweaveId: v.optional(v.union(v.string(), v.null())),
  splits: v.optional(
    v.array(v.object({ recipient: v.string(), bps: v.number() }))
  ),
  contentVersion: v.optional(v.number()),
  newAuthor: v.optional(v.string()),
  liveUntilLedger: v.optional(v.number()),
})

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
  /**
   * Tab tips only: what `tabs.prepareTip` returned. `tabs.submitTip`
   * re-checks it against the current pair state.
   */
  tabPrepare: v.optional(
    v.object({
      tabAccountId: v.id('tabAccounts'),
      keyId: v.number(),
      seq: v.number(),
      cumulativeBefore: v.string(),
      contentHash: v.string(),
    })
  ),
}

/** States of a tab receipt (06-app-integration.md, section 6.1). */
export const TAB_RECEIPT_STATUSES = [
  'ACCEPTED',
  'SETTLED',
  'SHORTFALL',
  'UNPAID',
  'REJECTED',
  'VOID_RESET',
] as const
export type TabReceiptStatus = (typeof TAB_RECEIPT_STATUSES)[number]

export const tabReceiptStatusValidator = v.union(
  v.literal('ACCEPTED'),
  v.literal('SETTLED'),
  v.literal('SHORTFALL'),
  v.literal('UNPAID'),
  v.literal('REJECTED'),
  v.literal('VOID_RESET')
)

/** `VoucherSkipped.reason` names (03-tab-contract.md, section 3.9). */
export const voucherSkipReasonValidator = v.union(
  v.literal('KEY_UNKNOWN'),
  v.literal('KEY_EXPIRED'),
  v.literal('STALE'),
  v.literal('SHORTFALL'),
  v.literal('NOT_ACCEPTED'),
  v.literal('UNKNOWN')
)

/**
 * Tab ledger tables (06-app-integration.md, section 6.2). Amounts are decimal
 * strings of base units. On-chain facts (`confirmedBalance`, `paidOnChain`,
 * key registration and revocation, account status) come only from indexed
 * Tab events; client input never sets them.
 */
export const tabTables = {
  tabAccounts: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    userId: v.id('users'),
    readerAddress: v.string(),
    tabContractId: v.string(),
    status: v.union(
      v.literal('OPEN'),
      v.literal('CLOSING'),
      v.literal('CLOSED')
    ),
    /** The reader's on-chain balance, from indexed events. */
    confirmedBalance: v.string(),
    /** Accepted but not yet settled: Σ (cumulative − paidOnChain) over pairs. */
    outstanding: v.string(),
    /**
     * Settled by the settler's own record but not yet debited from
     * `confirmedBalance` by the indexed `TabSettled` event:
     * Σ max(0, paidOnChain − indexed paid) over pairs. Spendable is
     * `confirmedBalance − outstanding − settledUnindexed`. Unset is zero.
     */
    settledUnindexed: v.optional(v.string()),
    /** Accepted today (UTC), for `TAB_DAILY_LIMIT`. */
    acceptedToday: v.string(),
    /** `YYYY-MM-DD` (UTC) that `acceptedToday` counts. */
    acceptedDay: v.string(),
    withdrawUnlockLedger: v.optional(v.number()),
    /** RPC id of the newest event that set the balance absolutely. */
    balanceEventId: v.optional(v.string()),
    /** `TabSettled` debits applied after `balanceEventId`, for reordering. */
    settledSinceBalance: v.array(
      v.object({ eventId: v.string(), gross: v.string() })
    ),
    /** RPC id of the newest event that set `status`. */
    statusEventId: v.optional(v.string()),
    /**
     * Running total, in US cents at tip time, of the reader's receipts that
     * still reserve the balance (`ACCEPTED`, `SHORTFALL`). Kept by
     * `syncReceiptMoney`; unset before it ran for this account.
     */
    reservedCents: v.optional(v.number()),
    /** Keys the client announced before registering them on chain. */
    pendingKeys: v.array(
      v.object({
        publicKey: v.string(),
        extractable: v.boolean(),
        declaredAt: v.number(),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_reader', ['readerAddress'])
    .index('by_status', ['status']),

  tabSessionKeys: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    tabAccountId: v.id('tabAccounts'),
    keyId: v.number(),
    /** ed25519, lowercase hex. Unset only while `KeyRevoked` arrived first. */
    publicKey: v.optional(v.string()),
    validUntilLedger: v.number(),
    spendLimit: v.string(),
    /** Σ paidOnChain over this key's pairs. */
    spentOnChain: v.string(),
    /** Σ accepted cumulative over this key's pairs. */
    acceptedTotal: v.string(),
    /** Revoked on chain (`KeyRevoked`) or by the reader in the app. */
    revoked: v.boolean(),
    revokedInApp: v.optional(v.boolean()),
    extractable: v.boolean(),
    registeredEventId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_account_key', ['tabAccountId', 'keyId']),

  tabReceipts: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    tabAccountId: v.id('tabAccounts'),
    keyId: v.number(),
    writerAddress: v.string(),
    authorId: v.id('users'),
    articleId: v.id('articles'),
    /** `article_id`, 32 bytes, lowercase hex. */
    articleKey: v.string(),
    /** `highlight_id`, 32 bytes, lowercase hex. */
    highlightId: v.optional(v.string()),
    seq: v.number(),
    amount: v.string(),
    cumulativeAfter: v.string(),
    clientRef: v.string(),
    contentHash: v.string(),
    leafHash: v.string(),
    tipRowId: v.union(v.id('tips'), v.id('highlightTips')),
    status: tabReceiptStatusValidator,
    settlementId: v.optional(v.id('tabSettlements')),
    /** The voucher that first anchored this receipt, as accepted. */
    receiptsRoot: v.string(),
    voucherSignature: v.string(),
    acceptorPublicKey: v.string(),
    acceptanceSignature: v.string(),
    acceptedAt: v.number(),
    settledEventId: v.optional(v.string()),
    /**
     * The tip's US cents as the reader chose them, copied from the tip row at
     * acceptance so the money views read one table. Unset on receipts
     * accepted before it existed; readers fall back to the tip row.
     */
    amountCents: v.optional(v.number()),
    /** The client's `requestId` of the tip, copied from the tip row. */
    requestId: v.optional(v.string()),
    /**
     * The status whose money the running figures (`tabAccounts.reservedCents`,
     * the `authorEarnings.balance*` fields) include. `syncReceiptMoney` moves
     * the receipt's money from this status to `status` once; unset means none.
     */
    moneyAppliedStatus: v.optional(tabReceiptStatusValidator),
    /** The cents this receipt holds in its writer bucket (pending, on hold
     * or not paid); unset on receipts applied before it existed. */
    moneyAppliedCents: v.optional(v.number()),
    /** The reader's cents it reserves (its unpaid part); unset as above. */
    moneyReservedCents: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_pair_seq', ['tabAccountId', 'keyId', 'writerAddress', 'seq'])
    /** A reader's receipts by time, for the tab screens' recent tips. */
    .index('by_account_accepted', ['tabAccountId', 'acceptedAt'])
    /** A writer's receipts by time, for the writer's earnings list. */
    .index('by_author_accepted', ['authorId', 'acceptedAt'])
    .index('by_status_created', ['status', 'createdAt'])
    .index('by_client_ref', ['clientRef'])
    .index('by_request', ['requestId']),

  tabVouchers: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    tabAccountId: v.id('tabAccounts'),
    tabContractId: v.string(),
    tokenContractId: v.string(),
    readerAddress: v.string(),
    keyId: v.number(),
    writerAddress: v.string(),
    /** The writer's user, credited with the pair's earnings. */
    authorId: v.id('users'),
    /** The latest accepted voucher of the pair. */
    cumulative: v.string(),
    receiptsRoot: v.string(),
    /** Leaf hashes in `seq` order, at most 256. */
    leafHashes: v.array(v.string()),
    signature: v.string(),
    acceptance: v.object({ acceptor: v.string(), signature: v.string() }),
    seq: v.number(),
    paidOnChain: v.string(),
    /**
     * Paid ranges `[paid_after − gross, paid_after]` of the `TabSettled`
     * events the indexer applied, merged. Their total is the part of
     * `paidOnChain` already debited from `confirmedBalance`. Unset means
     * all of `paidOnChain` (rows written before this field).
     */
    indexedPaid: v.optional(
      v.array(v.object({ from: v.string(), to: v.string() }))
    ),
    /** True while `paidOnChain < cumulative` and the pair can still settle. */
    unsettled: v.boolean(),
    /** Acceptance time of the oldest receipt not yet settled. */
    oldestUnsettledAt: v.optional(v.number()),
    state: v.union(
      v.literal('ACTIVE'),
      v.literal('UNPAID'),
      v.literal('VOID_RESET'),
      v.literal('REJECTED')
    ),
    /**
     * Last ledger at which the contract settles this pair:
     * the key's `valid_until + SETTLE_GRACE`.
     */
    settleBy: v.optional(v.number()),
    /**
     * Settler queue. `ready`: unsettled and selectable. `blocked`: skipped
     * as `SHORTFALL`, waiting for a deposit. `inflight`: in an unfinished
     * settlement. `done`: nothing left to settle, or a terminal state.
     */
    settleQueue: v.optional(
      v.union(
        v.literal('ready'),
        v.literal('blocked'),
        v.literal('inflight'),
        v.literal('done')
      )
    ),
    /** The unfinished settlement that holds this pair. */
    settlementId: v.optional(v.id('tabSettlements')),
    rejectedReason: v.optional(v.string()),
    /** The pair's figures last applied to `authorEarnings` (section 6.2). */
    earnedNet: v.string(),
    pendingNet: v.string(),
    lastSkipReason: v.optional(voucherSkipReasonValidator),
    lastSkipEventId: v.optional(v.string()),
    /** RPC id of the newest `TabSettled` applied. */
    lastSettledEventId: v.optional(v.string()),
    acceptedAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_pair', ['tabAccountId', 'keyId', 'writerAddress'])
    .index('by_writer', ['writerAddress'])
    .index('by_due', ['unsettled', 'oldestUnsettledAt'])
    .index('by_queue_settle_by', ['settleQueue', 'settleBy'])
    .index('by_queue_age', ['settleQueue', 'oldestUnsettledAt'])
    .index('by_epoch_state', ['chainEpoch', 'state']),

  tabSettlements: defineTable({
    network: chainNetworkValidator,
    chainEpoch: v.string(),
    tabContractId: v.optional(v.string()),
    submissionId: v.optional(v.id('chainSubmissions')),
    /** `localKey` or `relayer`. */
    submitter: v.optional(v.string()),
    /** The submitter's stable reference (the transaction hash for `localKey`). */
    reference: v.optional(v.string()),
    txHash: v.optional(v.string()),
    /** Signed envelope, kept so a crash after recording can re-send it. */
    envelopeXdr: v.optional(v.string()),
    /** Unix seconds; the transaction's upper time bound. */
    maxTime: v.optional(v.number()),
    voucherIds: v.array(v.id('tabVouchers')),
    /** The cumulative amount submitted for each voucher, in order. */
    cumulatives: v.optional(v.array(v.string())),
    gross: v.string(),
    fee: v.string(),
    settled: v.optional(v.number()),
    skipped: v.optional(v.number()),
    ledger: v.optional(v.number()),
    status: chainRecordStatusValidator,
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_status', ['status']),
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
    /** Token whose Core total the NFT threshold compares. */
    nftThresholdToken: v.optional(v.string()),
    /** Tab `config().acceptor_keys`, lowercase hex (current first). */
    tabAcceptorKeys: v.optional(v.array(v.string())),
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
    /** `article_ref`, 32 bytes, lowercase hex. */
    articleRef: v.optional(v.string()),
    /** Ledger until which `pendingAuthor` may accept. */
    pendingAuthorLiveUntil: v.optional(v.number()),
    /** The latest article submission (register, update or author change). */
    lastSubmissionId: v.optional(v.id('chainSubmissions')),
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
    /** NFT submissions only: the values verification expects. */
    expectedNft: v.optional(expectedNftValidator),
    /**
     * NFT submissions only: `<nft contract>:mint:<article key>` or
     * `<nft contract>:token:<token id>`, so an indexed event finds them.
     */
    nftKey: v.optional(v.string()),
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
    /** Article submissions only: the values verification expects. */
    expectedArticle: v.optional(expectedArticleValidator),
    ledger: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_request', ['requestId'])
    .index('by_tx', ['txHash'])
    .index('by_status_updated', ['status', 'updatedAt'])
    .index('by_nft_key', ['nftKey']),

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
