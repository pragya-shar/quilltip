/**
 * Tab functions (docs/architecture/v2/06-app-integration.md, section 6.3;
 * 05-flows-and-admin.md, sections 5.5 to 5.9).
 *
 * The reader prepares and submits tab tips here; Convex verifies each voucher
 * and countersigns it. On-chain tab state comes only from the event indexer
 * (`convex/lib/chain/tabEventHandlers.ts`). Settlement is in the settler,
 * which reads `tabSettlement.selectCandidates`.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { readChainEnv } from './lib/chain/env'
import { isHexOfLength } from './lib/chain/ids'
import {
  MAX_KEY_LIFETIME_LEDGERS,
  currentLedgerEstimate,
  insertTabAccount,
  pairOutstanding,
  prepareTabTip,
  requireTabChain,
  sweepExpiredPairs,
  settlementVoucher,
  submitTabTip,
  tabAccountForReader,
  tabError,
  tabKey,
  voidEpochPairs,
} from './lib/chain/tabLedger'
import { verifiedStellarAddress } from './lib/walletVerification'

const receiptValidator = v.object({
  amount: v.string(),
  articleId: v.string(),
  clientRef: v.string(),
  contentHash: v.string(),
  cumulativeAfter: v.string(),
  highlightId: v.union(v.string(), v.null()),
  seq: v.number(),
})

const highlightValidator = v.object({
  text: v.string(),
  startOffset: v.number(),
  endOffset: v.number(),
  startContainerPath: v.optional(v.string()),
  endContainerPath: v.optional(v.string()),
})

const MAX_PENDING_KEYS = 8

async function requireUserId(ctx: QueryCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId) {
    throw new ConvexError({
      code: 'UNAUTHENTICATED',
      message: 'Sign in first.',
    })
  }
  return userId
}

// ---------------------------------------------------------------------------
// Tab tips (5.6)

/**
 * Step 1 of a tab tip. Checks every acceptance rule and returns the pair's
 * `seq`, `cumulative_before`, the receipt fields and the earlier leaf hashes.
 * Repeating a `requestId` returns the same prepared tip.
 */
export const prepareTip = mutation({
  args: {
    requestId: v.string(),
    articleId: v.id('articles'),
    amountCents: v.number(),
    keyId: v.number(),
    highlight: v.optional(v.union(highlightValidator, v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    return prepareTabTip(ctx, { ...args, userId, now: Date.now() })
  },
})

/**
 * Step 3 of a tab tip, in one mutation: verifies the session-key signature
 * over the recomputed payload, re-checks I-22, countersigns, and stores the
 * receipt and the pair's latest voucher. Repeating an accepted submit returns
 * the same acceptance.
 */
export const submitTip = mutation({
  args: {
    prepareId: v.union(v.id('tips'), v.id('highlightTips')),
    receipt: receiptValidator,
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    return submitTabTip(ctx, { ...args, userId, now: Date.now() })
  },
})

// ---------------------------------------------------------------------------
// Tab operations (5.5, 5.9). The reader's wallet signs these; the indexer
// applies their events. Prepare checks the inputs and returns what the
// client needs to build the call.

type ReaderContext = {
  chain: ReturnType<typeof requireTabChain>
  user: Doc<'users'>
  readerAddress: string
  account: Doc<'tabAccounts'> | null
  ledger: number
}

async function readerContext(
  ctx: MutationCtx,
  now: number
): Promise<ReaderContext> {
  const userId = await requireUserId(ctx)
  const chain = requireTabChain()
  const user = await ctx.db.get(userId)
  const readerAddress = verifiedStellarAddress(user, chain.passphrase)
  if (!user || !readerAddress) {
    tabError('TAB_READER_UNVERIFIED', 'Verify your Stellar wallet first.')
  }
  const account = await tabAccountForReader(
    ctx,
    readerAddress,
    chain.chainEpoch
  )
  if (account && account.userId !== user._id) {
    tabError(
      'TAB_ACCOUNT_OTHER_USER',
      'This address has a tab under another account.'
    )
  }
  const ledger = await currentLedgerEstimate(ctx, chain, now)
  return { chain, user, readerAddress, account, ledger }
}

function operationResult(c: ReaderContext) {
  return {
    tabContractId: c.chain.tabContractId,
    tokenContractId: c.chain.tokenContractId,
    readerAddress: c.readerAddress,
    networkPassphrase: c.chain.passphrase,
    currentLedger: c.ledger,
  }
}

function checkAmount(amount: string, allowZero: boolean): void {
  if (
    !/^(0|[1-9][0-9]{0,30})$/.test(amount) ||
    (!allowZero && amount === '0')
  ) {
    tabError('INVALID_PREPARE', 'Invalid amount.')
  }
}

function checkKeyParams(
  c: ReaderContext,
  key: { publicKey: string; validUntil: number; spendLimit: string }
): void {
  if (!isHexOfLength(key.publicKey, 32) || /^0+$/.test(key.publicKey)) {
    tabError('INVALID_PREPARE', 'Invalid session public key.')
  }
  if (
    !Number.isInteger(key.validUntil) ||
    key.validUntil <= c.ledger ||
    key.validUntil > c.ledger + MAX_KEY_LIFETIME_LEDGERS
  ) {
    tabError('INVALID_PREPARE', 'Invalid key expiry ledger.')
  }
  checkAmount(key.spendLimit, false)
}

/** Records a key the client will register, so `extractable` is known. */
async function declareKey(
  ctx: MutationCtx,
  c: ReaderContext,
  key: { publicKey: string; extractable: boolean },
  now: number
): Promise<void> {
  const account =
    c.account ??
    (await insertTabAccount(ctx, {
      network: c.chain.network,
      chainEpoch: c.chain.chainEpoch,
      userId: c.user._id,
      readerAddress: c.readerAddress,
      tabContractId: c.chain.tabContractId,
      now,
    }))
  const pendingKeys = [
    ...account.pendingKeys.filter((k) => k.publicKey !== key.publicKey),
    { publicKey: key.publicKey, extractable: key.extractable, declaredAt: now },
  ].slice(-MAX_PENDING_KEYS)
  await ctx.db.patch(account._id, { pendingKeys, updatedAt: now })
}

const keyArgs = {
  publicKey: v.string(),
  validUntil: v.number(),
  spendLimit: v.string(),
  extractable: v.boolean(),
}

/** `Tab.open_session`: deposit and first key in one call. */
export const prepareOpen = mutation({
  args: { amount: v.string(), ...keyArgs },
  handler: async (ctx, args) => {
    const now = Date.now()
    const c = await readerContext(ctx, now)
    checkAmount(args.amount, true)
    checkKeyParams(c, args)
    await declareKey(ctx, c, args, now)
    return operationResult(c)
  },
})

/** `Tab.deposit` (top-up). */
export const prepareDeposit = mutation({
  args: { amount: v.string() },
  handler: async (ctx, args) => {
    const c = await readerContext(ctx, Date.now())
    if (!c.account) tabError('TAB_NO_ACCOUNT', 'Open a tab first.')
    checkAmount(args.amount, false)
    return operationResult(c)
  },
})

/** `Tab.register_key` (rotation or a lost key). */
export const prepareRegisterKey = mutation({
  args: keyArgs,
  handler: async (ctx, args) => {
    const now = Date.now()
    const c = await readerContext(ctx, now)
    checkKeyParams(c, args)
    await declareKey(ctx, c, args, now)
    return operationResult(c)
  },
})

/**
 * `Tab.revoke_key`. Convex stops accepting under the key at once (section
 * 3.5, item 5); the `KeyRevoked` event later lowers its expiry.
 */
export const prepareRevokeKey = mutation({
  args: { keyId: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now()
    const c = await readerContext(ctx, now)
    const key = c.account ? await tabKey(ctx, c.account._id, args.keyId) : null
    if (!key) tabError('TAB_KEY_UNKNOWN', 'This session key is not registered.')
    await ctx.db.patch(key._id, {
      revoked: true,
      revokedInApp: true,
      updatedAt: now,
    })
    return { ...operationResult(c), keyId: args.keyId }
  },
})

/** `Tab.withdraw_start`. The tab becomes `CLOSING` when the event arrives. */
export const prepareWithdrawStart = mutation({
  args: {},
  handler: async (ctx) => {
    const c = await readerContext(ctx, Date.now())
    if (!c.account) tabError('TAB_NO_ACCOUNT', 'Open a tab first.')
    return operationResult(c)
  },
})

/** `Tab.withdraw`, after `unlock_ledger`. */
export const prepareWithdraw = mutation({
  args: {},
  handler: async (ctx) => {
    const c = await readerContext(ctx, Date.now())
    if (!c.account || c.account.status !== 'CLOSING') {
      tabError('TAB_NO_WITHDRAWAL', 'No withdrawal is pending.')
    }
    return {
      ...operationResult(c),
      withdrawUnlockLedger: c.account.withdrawUnlockLedger ?? null,
    }
  },
})

// ---------------------------------------------------------------------------
// Reads

async function verifiedAddressOf(
  ctx: QueryCtx
): Promise<{ address: string; chain: ReturnType<typeof readChainEnv> } | null> {
  const userId = await getAuthUserId(ctx)
  if (!userId) return null
  const chain = readChainEnv()
  const user = await ctx.db.get(userId)
  const address = verifiedStellarAddress(user, chain.passphrase)
  return address ? { address, chain } : null
}

/** The reader's tab, keys and pairs, or null. */
export const getMyTab = query({
  args: {},
  handler: async (ctx) => {
    const me = await verifiedAddressOf(ctx)
    if (!me || !me.chain.tabContractId) return null
    const userId = await getAuthUserId(ctx)
    const account = await tabAccountForReader(
      ctx,
      me.address,
      me.chain.chainEpoch
    )
    if (!account || account.userId !== userId) return null
    const keys = await ctx.db
      .query('tabSessionKeys')
      .withIndex('by_account_key', (q) => q.eq('tabAccountId', account._id))
      .take(200)
    const pairs = await ctx.db
      .query('tabVouchers')
      .withIndex('by_pair', (q) => q.eq('tabAccountId', account._id))
      .take(500)
    return {
      tabContractId: account.tabContractId,
      readerAddress: account.readerAddress,
      status: account.status,
      confirmedBalance: account.confirmedBalance,
      outstanding: account.outstanding,
      available: (
        BigInt(account.confirmedBalance) - BigInt(account.outstanding)
      ).toString(),
      acceptedToday: account.acceptedToday,
      acceptedDay: account.acceptedDay,
      withdrawUnlockLedger: account.withdrawUnlockLedger ?? null,
      keys: keys.map((k) => ({
        keyId: k.keyId,
        publicKey: k.publicKey ?? null,
        validUntilLedger: k.validUntilLedger,
        spendLimit: k.spendLimit,
        spentOnChain: k.spentOnChain,
        acceptedTotal: k.acceptedTotal,
        revoked: k.revoked,
        extractable: k.extractable,
      })),
      pairs: pairs.map((p) => ({
        keyId: p.keyId,
        writer: p.writerAddress,
        seq: p.seq,
        cumulative: p.cumulative,
        paidOnChain: p.paidOnChain,
        leafHashes: p.leafHashes,
        state: p.state,
      })),
    }
  },
})

/** The writer's tab earnings: pending and earned net, per pair and summed. */
export const getWriterPending = query({
  args: {},
  handler: async (ctx) => {
    const me = await verifiedAddressOf(ctx)
    if (!me) return null
    const vouchers = (
      await ctx.db
        .query('tabVouchers')
        .withIndex('by_writer', (q) => q.eq('writerAddress', me.address))
        .take(1000)
    ).filter((row) => row.chainEpoch === me.chain.chainEpoch)
    const totals: Record<string, { earned: string; pending: string }> = {}
    for (const row of vouchers) {
      const t = totals[row.tokenContractId] ?? { earned: '0', pending: '0' }
      totals[row.tokenContractId] = {
        earned: (BigInt(t.earned) + BigInt(row.earnedNet)).toString(),
        pending: (BigInt(t.pending) + BigInt(row.pendingNet)).toString(),
      }
    }
    return {
      writerAddress: me.address,
      totals,
      pairs: vouchers.map((row) => ({
        reader: row.readerAddress,
        keyId: row.keyId,
        cumulative: row.cumulative,
        paidOnChain: row.paidOnChain,
        earnedNet: row.earnedNet,
        pendingNet: row.pendingNet,
        state: row.state,
        lastSkipReason: row.lastSkipReason ?? null,
      })),
    }
  },
})

/**
 * The latest countersigned voucher of every pair that still owes the writer,
 * for the dashboard's download and `settle_own` (section 3.7).
 */
export const getLatestVouchersForWriter = query({
  args: {},
  handler: async (ctx) => {
    const me = await verifiedAddressOf(ctx)
    if (!me) return null
    const rows = (
      await ctx.db
        .query('tabVouchers')
        .withIndex('by_writer', (q) => q.eq('writerAddress', me.address))
        .take(1000)
    ).filter(
      (row) =>
        row.chainEpoch === me.chain.chainEpoch &&
        row.state === 'ACTIVE' &&
        pairOutstanding(row) > BigInt(0)
    )
    const vouchers = []
    for (const row of rows) {
      const key = await tabKey(ctx, row.tabAccountId, row.keyId)
      vouchers.push({
        ...settlementVoucher(row, key?.publicKey),
        paidOnChain: row.paidOnChain,
        seq: row.seq,
      })
    }
    return { networkPassphrase: me.chain.passphrase, vouchers }
  },
})

// ---------------------------------------------------------------------------
// Settler and operator functions

/**
 * Marks receipts `UNPAID` for pairs whose key settle window
 * (`valid_until + SETTLE_GRACE`) has ended, whatever the account status. The
 * settler runs the same sweep each cycle. Bounded per call.
 */
export const sweepUnpaid = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    const now = Date.now()
    const ledger = await currentLedgerEstimate(ctx, chain, now)
    return sweepExpiredPairs(ctx, {
      ledger,
      limit: Math.min(Math.max(1, args.limit ?? 100), 500),
      now,
    })
  },
})

/**
 * After a testnet reset (section 7.4): unsettled receipts of the closed
 * epoch become `VOID_RESET`. Refuses the current epoch. Bounded per call.
 */
export const voidResetEpoch = internalMutation({
  args: { chainEpoch: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const chain = readChainEnv()
    if (args.chainEpoch === chain.chainEpoch) {
      tabError(
        'TAB_EPOCH_CURRENT',
        'Start a new CHAIN_EPOCH before voiding this one.'
      )
    }
    return voidEpochPairs(ctx, {
      chainEpoch: args.chainEpoch,
      limit: Math.min(Math.max(1, args.limit ?? 100), 500),
      now: Date.now(),
    })
  },
})
