/**
 * Stand-in for Convex, the indexer, the settler and Stellar RPC behind the
 * tab UI fixture (port 4183). One state per `session`, shared by every page
 * of that session, so two browser tabs see one tab ledger.
 *
 * It follows the real rules where the UI depends on them:
 * - `prepareTip` builds the receipt on the pair's current state;
 *   `submitTip` verifies the ed25519 voucher signature over the payload the
 *   browser library signs, accepts only on top of the current state
 *   (`TAB_STALE_PREPARE` otherwise), and repeats an accepted submit.
 * - Tab operations change the tab only when the "indexer" applies them,
 *   after `indexDelayMs`, as `getMyTab` would show them.
 * Nothing here is used by the app.
 */
import { ed25519 } from '@noble/curves/ed25519'

import { hexToBytes } from '../../../lib/stellar/v2/tab/bytes'
import {
  receiptLeafHex,
  receiptsRootHex,
  voucherPayloadFor,
  type PreparedTabTip,
  type StoredReceipt,
  type SubmittedTabTip,
} from '../../../lib/stellar/v2/tab'
import type {
  ChainConfigView,
  KeyParams,
  LedgerClock,
  MyTab,
  MyTabEarnings,
  MyTabTips,
  TabCall,
  TabLimits,
  TabTipRow,
  WalletFunds,
} from '../../../lib/tab-ui/types'
import {
  FIXTURE_PASSPHRASE,
  FIXTURE_READER,
  FIXTURE_TAB,
  FIXTURE_TOKEN,
  FIXTURE_WRITER,
} from './constants'

export type GateKind =
  | 'ready'
  | 'checking'
  | 'signed-out'
  | 'no-wallet'
  | 'disconnected'
  | 'locked'
  | 'wrong-network'
  | 'unverified'

/** How the stand-in wallet and RPC answer the next `send`. */
export type SendBehaviour =
  | 'ok'
  | 'declined'
  | 'cancelled'
  | 'locked'
  | 'wrong-network'
  | 'timeout'
  | 'balance'
  | 'paused'
  | 'withdraw-locked'
  | 'simulation'
  | 'send-error'
  | 'busy'
  /** Stop at a step and never return (pending states). */
  | 'hang-simulating'
  | 'hang-signing'
  | 'hang-sending'

export type PollBehaviour = 'success' | 'failed' | 'timeout' | 'hang'

export type FixtureState = {
  scenario: string
  gate: GateKind
  /** Verified linked address (null: none). */
  address: string | null
  chainConfig: ChainConfigView
  tab: MyTab | null
  tips: TabTipRow[]
  settlementEnabled: boolean
  oldestUnsettledAt: number | null
  settleWindowEndsSoon: boolean
  earnings: MyTabEarnings | null
  claimable: string
  clock: LedgerClock
  /** Stellar RPC cannot be reached: the ledger read fails. */
  rpcDown: boolean
  funds: WalletFunds | null
  limits: TabLimits | null
  send: SendBehaviour
  poll: PollBehaviour
  /** Milliseconds before the "indexer" applies a sent operation; -1: never. */
  indexDelayMs: number
  /** `TAB_*` refusal of every prepare of this operation. */
  prepareRefusal: Partial<Record<TabCall['method'] | 'tip', string>>
  /** `TAB_*` refusal of the next tip submit(s). */
  submitRefusal: { code: string; times: number } | null
  /** Lost responses of the next submits (accepted, then answer dropped). */
  loseSubmits: number
  /** Status the settler gives accepted tips, after `settleDelayMs`. */
  settleAs:
    | 'SETTLED'
    | 'SHORTFALL'
    | 'UNPAID'
    | 'REJECTED'
    | 'VOID_RESET'
    | null
  settleDelayMs: number
  /** Pair state per `keyId|writer`. */
  pairs: Record<string, { seq: number; cumulative: string; leaves: string[] }>
  prepared: Record<string, PreparedTabTip>
  accepted: Record<string, SubmittedTabTip>
  nextKeyId: number
  calls: string[]
  /** Spend limit of the key the page seeds as ready; 50 XLM when unset. */
  keySpendLimit?: bigint
}

export const XLM = BigInt(10_000_000)
const ZERO = BigInt(0)
/** The fixture prices XLM at $0.10: one cent is 0.1 XLM. */
export const STROOPS_PER_CENT = BigInt(1_000_000)
export const PRICE_USD = 0.1
/** `TAB_TIP_MAX` and `TAB_DAILY_LIMIT` defaults: 5 and 20 XLM. */
export const TIP_MAX = BigInt(5) * BigInt(10_000_000)
export const DAILY_LIMIT = BigInt(20) * BigInt(10_000_000)

/** `TAB_PRICE_MAX_AGE_MS`: prepare refuses a price older than 30 minutes. */
export const PRICE_MAX_AGE_MS = 30 * 60 * 1000

/** The UTC day of a time, as Convex counts the daily limit. */
export const utcDayOf = (at: number) => new Date(at).toISOString().slice(0, 10)

/**
 * What `tabs.getMyTab` returns as `tipLimits`, at the fixture's price: raw
 * values, fetched now, nothing accepted today unless the scenario says.
 */
export function tipLimitsFor(
  o: Partial<NonNullable<MyTab['tipLimits']>> = {}
): NonNullable<MyTab['tipLimits']> {
  const tipMax = BigInt(o.tipMax ?? TIP_MAX.toString())
  const priceUsd = o.priceUsd === undefined ? PRICE_USD : o.priceUsd
  return {
    tipMax: tipMax.toString(),
    dailyLimit: DAILY_LIMIT.toString(),
    acceptedToday: o.acceptedToday ?? '0',
    acceptedDay: o.acceptedDay ?? utcDayOf(Date.now()),
    minTip: o.minTip === undefined ? '100000' : o.minTip,
    priceUsd,
    priceFetchedAt:
      o.priceFetchedAt !== undefined
        ? o.priceFetchedAt
        : priceUsd === null
          ? null
          : Date.now(),
    priceMaxAgeMs: PRICE_MAX_AGE_MS,
    tipMaxCents:
      o.tipMaxCents !== undefined
        ? o.tipMaxCents
        : priceUsd === null
          ? null
          : Number(tipMax / STROOPS_PER_CENT),
  }
}
export const LEDGER = 1_000_000
const DAY = 17_280
/** Server start: scenario times are relative to the real clock. */
export const NOW = Date.now()

export function baseState(scenario: string): FixtureState {
  return {
    scenario,
    gate: 'ready',
    address: FIXTURE_READER,
    chainConfig: {
      network: 'TESTNET',
      chainEpoch: 'fixture',
      v2Enabled: true,
      coreContractId: null,
      tabContractId: FIXTURE_TAB,
      nftContractId: null,
      tokenContractId: FIXTURE_TOKEN,
      minTip: '100000',
      feeBps: 250,
      nftThreshold: null,
      paused: {},
      refreshedAt: NOW,
    } as ChainConfigView,
    tab: null,
    tips: [],
    settlementEnabled: true,
    oldestUnsettledAt: null,
    settleWindowEndsSoon: false,
    earnings: null,
    claimable: '0',
    clock: { sequence: LEDGER, closedAt: NOW },
    rpcDown: false,
    funds: {
      balance: (BigInt(120) * XLM).toString(),
      reserve: (BigInt(1) * XLM).toString(),
      spendable: (BigInt(119) * XLM).toString(),
    },
    limits: {
      minDeposit: XLM.toString(),
      maxBalance: (BigInt(1_000) * XLM).toString(),
    },
    send: 'ok',
    poll: 'success',
    indexDelayMs: 400,
    prepareRefusal: {},
    submitRefusal: null,
    loseSubmits: 0,
    settleAs: null,
    settleDelayMs: 600,
    pairs: {},
    prepared: {},
    accepted: {},
    nextKeyId: 0,
    calls: [],
  }
}

export function openTab(
  state: FixtureState,
  balance: bigint,
  keys: MyTab['keys'] = []
): void {
  state.tab = {
    tabContractId: FIXTURE_TAB,
    readerAddress: FIXTURE_READER,
    status: 'OPEN',
    confirmedBalance: balance.toString(),
    outstanding: '0',
    available: balance.toString(),
    acceptedToday: '0',
    acceptedDay: '2026-11-27',
    withdrawUnlockLedger: null,
    onChain: true,
    tipLimits: tipLimitsFor(),
    keys,
    pairs: [],
  }
  state.nextKeyId = keys.reduce((n, k) => Math.max(n, k.keyId + 1), 0)
}

export function serverKey(
  keyId: number,
  publicKey: string,
  o: {
    validUntil?: number
    revoked?: boolean
    spent?: bigint
    limit?: bigint
  } = {}
): MyTab['keys'][number] {
  return {
    keyId,
    publicKey,
    validUntilLedger: o.validUntil ?? LEDGER + 7 * DAY,
    spendLimit: (o.limit ?? BigInt(50) * XLM).toString(),
    spentOnChain: '0',
    acceptedTotal: (o.spent ?? ZERO).toString(),
    revoked: o.revoked ?? false,
    extractable: false,
  }
}

export function tipRow(
  i: number,
  status: TabTipRow['status'],
  o: Partial<TabTipRow> = {}
): TabTipRow {
  return {
    receiptId: `receipt-${i}`,
    status,
    amount: (BigInt(i + 1) * BigInt(2_500_000)).toString(),
    writer: FIXTURE_WRITER,
    keyId: 0,
    seq: i + 1,
    articleTitle: [
      'The quiet economics of attention',
      'Notes on slow reading',
      'Why marginalia matter',
      'A field guide to footnotes',
      'Letters to a young editor',
      'On the shape of paragraphs',
    ][i % 6]!,
    articleSlug: `article-${i}`,
    authorName: 'Ada Lovelace',
    authorUsername: 'ada',
    highlight: i % 3 === 1,
    acceptedAt: NOW - (i + 1) * 3_600_000,
    settledTxHash: status === 'SETTLED' ? 'ab'.repeat(32) : null,
    ...o,
  }
}

export class FixtureError extends Error {
  constructor(
    readonly code: string,
    message = code
  ) {
    super(message)
  }
}

function recomputeTab(state: FixtureState): void {
  if (!state.tab) return
  const outstanding = state.tips
    .filter((t) => t.status === 'ACCEPTED' || t.status === 'SHORTFALL')
    .reduce((sum, t) => sum + BigInt(t.amount), ZERO)
  state.tab.outstanding = outstanding.toString()
  state.tab.available = (
    BigInt(state.tab.confirmedBalance) - outstanding
  ).toString()
  const unsettled = state.tips.filter((t) => t.status === 'ACCEPTED')
  state.oldestUnsettledAt = unsettled.length
    ? Math.min(...unsettled.map((t) => t.acceptedAt))
    : null
}

export function activity(state: FixtureState): MyTabTips | null {
  if (!state.tab) return null
  return {
    settlementEnabled: state.settlementEnabled,
    oldestUnsettledAt: state.oldestUnsettledAt,
    settleWindowEndsSoon: state.settleWindowEndsSoon,
    tips: [...state.tips].sort((a, b) => b.acceptedAt - a.acceptedAt),
  }
}

// --- Operations ---------------------------------------------------------------

function operationContext(state: FixtureState) {
  return {
    tabContractId: FIXTURE_TAB,
    tokenContractId: FIXTURE_TOKEN,
    readerAddress: state.address ?? FIXTURE_READER,
    networkPassphrase: FIXTURE_PASSPHRASE,
    currentLedger: state.clock.sequence,
  }
}

export function prepareOperation(
  state: FixtureState,
  method: TabCall['method'],
  args: Partial<KeyParams & { amount: string; keyId: number }>
) {
  state.calls.push(`prepare:${method}`)
  const refusal = state.prepareRefusal[method]
  if (refusal) throw new FixtureError(refusal)
  if (!state.address) throw new FixtureError('TAB_READER_UNVERIFIED')
  if ((method === 'deposit' || method === 'withdraw_start') && !state.tab)
    throw new FixtureError('TAB_NO_ACCOUNT')
  if (method === 'open_session' && !state.tab) {
    // Like tabs.prepareOpen: the account exists from the prepare, with no
    // Tab event indexed until the "indexer" applies the open.
    openTab(state, ZERO)
    state.tab!.onChain = false
  }
  if (method === 'withdraw') {
    if (state.tab?.status !== 'CLOSING')
      throw new FixtureError('TAB_NO_WITHDRAWAL')
    return {
      ...operationContext(state),
      withdrawUnlockLedger: state.tab.withdrawUnlockLedger,
    }
  }
  if (method === 'revoke_key' && state.tab) {
    const key = state.tab.keys.find((k) => k.keyId === args.keyId)
    if (!key) throw new FixtureError('TAB_KEY_UNKNOWN')
  }
  return operationContext(state)
}

/** What `sendContractCall` returns for the current behaviour. */
export function sendOperation(
  state: FixtureState,
  call: TabCall,
  hash: string
):
  | { status: 'sent'; hash: string }
  | { status: 'wallet_failed'; error: { kind: string } }
  | {
      status: 'simulation_failed' | 'send_error'
      error: {
        code: number | null
        name: string | null
        contract?: string
        message: string
      }
      detail: string
    }
  | { status: 'not_sent'; detail: string }
  | { hang: 'simulating' | 'signing' | 'sending' } {
  state.calls.push(`send:${call.method}`)
  switch (state.send) {
    case 'hang-simulating':
      return { hang: 'simulating' }
    case 'hang-signing':
      return { hang: 'signing' }
    case 'hang-sending':
      return { hang: 'sending' }
    case 'declined':
      return { status: 'wallet_failed', error: { kind: 'rejected' } }
    case 'cancelled':
      return { status: 'wallet_failed', error: { kind: 'cancelled' } }
    case 'locked':
      return { status: 'wallet_failed', error: { kind: 'locked' } }
    case 'wrong-network':
      return { status: 'wallet_failed', error: { kind: 'wrong-network' } }
    case 'timeout':
      return { status: 'wallet_failed', error: { kind: 'timeout' } }
    case 'balance':
      return {
        status: 'simulation_failed',
        error: {
          code: 10,
          name: 'BalanceError',
          contract: 'token',
          message: 'This wallet needs more testnet XLM.',
        },
        detail: 'Error(Contract, #10)',
      }
    case 'paused':
      return {
        status: 'simulation_failed',
        error: {
          code: 1000,
          name: 'EnforcedPause',
          contract: 'tab',
          message: 'Payments are paused for maintenance. Try again later.',
        },
        detail: 'Error(Contract, #1000)',
      }
    case 'withdraw-locked':
      return {
        status: 'simulation_failed',
        error: {
          code: 41,
          name: 'WithdrawLocked',
          contract: 'tab',
          message: 'Your withdrawal is not unlocked yet.',
        },
        detail: 'Error(Contract, #41)',
      }
    case 'simulation':
      return {
        status: 'simulation_failed',
        error: {
          code: 32,
          name: 'BalanceCapExceeded',
          contract: 'tab',
          message: 'This deposit would take your tab over its limit.',
        },
        detail: 'Error(Contract, #32)',
      }
    case 'send-error':
      return {
        status: 'send_error',
        error: {
          code: null,
          name: null,
          message: 'Stellar testnet refused the transaction. Nothing was sent.',
        },
        detail: 'txBadSeq',
      }
    case 'busy':
      return { status: 'not_sent', detail: 'TRY_AGAIN_LATER' }
    case 'ok':
      return { status: 'sent', hash }
  }
}

/** The indexer applies a sent operation's events. */
export function applyOperation(
  state: FixtureState,
  call: TabCall,
  signer: string
): void {
  const now = Date.now()
  switch (call.method) {
    case 'open_session': {
      const before = state.tab ? BigInt(state.tab.confirmedBalance) : ZERO
      const keys = state.tab?.keys ?? []
      openTab(state, before + BigInt(call.amount), [
        ...keys,
        serverKey(state.nextKeyId, call.key.publicKey, {
          validUntil: call.key.validUntil,
          limit: BigInt(call.key.spendLimit),
        }),
      ])
      break
    }
    case 'deposit':
      if (!state.tab) return
      state.tab.confirmedBalance = (
        BigInt(state.tab.confirmedBalance) + BigInt(call.amount)
      ).toString()
      // A deposit during CLOSING cancels the withdrawal (5.9, step 4).
      state.tab.status = 'OPEN'
      state.tab.withdrawUnlockLedger = null
      break
    case 'register_key':
      if (!state.tab) return
      state.tab.keys = [
        ...state.tab.keys,
        serverKey(state.nextKeyId, call.key.publicKey, {
          validUntil: call.key.validUntil,
          limit: BigInt(call.key.spendLimit),
        }),
      ]
      state.nextKeyId += 1
      break
    case 'revoke_key':
      if (!state.tab) return
      state.tab.keys = state.tab.keys.map((k) =>
        k.keyId === call.keyId
          ? {
              ...k,
              revoked: true,
              validUntilLedger: Math.min(
                k.validUntilLedger,
                state.clock.sequence
              ),
            }
          : k
      )
      break
    case 'withdraw_start':
      if (!state.tab) return
      state.tab.status = 'CLOSING'
      state.tab.withdrawUnlockLedger = state.clock.sequence + 3 * DAY
      break
    case 'withdraw':
      if (!state.tab) return
      state.tab.status = 'CLOSED'
      state.tab.confirmedBalance = '0'
      state.tab.withdrawUnlockLedger = null
      break
    case 'claim':
      if (state.earnings && signer) {
        state.earnings.collected = (
          BigInt(state.earnings.collected) + BigInt(state.claimable)
        ).toString()
        state.claimable = '0'
      }
      break
  }
  void now
  recomputeTab(state)
}

// --- Tab tips -----------------------------------------------------------------

export function prepareTip(
  state: FixtureState,
  args: {
    requestId: string
    articleId: string
    amountCents: number
    keyId: number
  }
): PreparedTabTip {
  state.calls.push('prepareTip')
  const existing = Object.values(state.prepared).find(
    (p) =>
      (p as PreparedTabTip & { requestId?: string }).requestId ===
      args.requestId
  )
  if (existing) return { ...structuredClone(existing), existing: true }
  const refusal = state.prepareRefusal.tip
  if (refusal) throw new FixtureError(refusal)
  if (!state.tab) throw new FixtureError('TAB_NO_ACCOUNT')
  if (state.tab.status === 'CLOSING') throw new FixtureError('TAB_CLOSING')
  if (state.tab.status === 'CLOSED') throw new FixtureError('TAB_CLOSED')
  const key = state.tab.keys.find((k) => k.keyId === args.keyId)
  if (!key) throw new FixtureError('TAB_KEY_UNKNOWN')
  if (key.revoked) throw new FixtureError('TAB_KEY_REVOKED')
  const amount = BigInt(args.amountCents) * STROOPS_PER_CENT
  // Prepare's order (convex/lib/chain/tabLedger.ts, checkTabTip).
  const limits = state.tab.tipLimits
  if (limits && amount > BigInt(limits.tipMax))
    throw new FixtureError('TAB_ABOVE_TIP_MAX')
  if (limits) {
    const today = utcDayOf(Date.now())
    const accepted =
      limits.acceptedDay === today ? BigInt(limits.acceptedToday) : ZERO
    if (accepted + amount > BigInt(limits.dailyLimit))
      throw new FixtureError('TAB_DAILY_LIMIT')
  }
  if (BigInt(state.tab.available) < amount)
    throw new FixtureError('TAB_OVER_BALANCE')
  const pairId = `${args.keyId}|${FIXTURE_WRITER}`
  const pair = state.pairs[pairId] ?? { seq: 0, cumulative: '0', leaves: [] }
  const n = Object.keys(state.prepared).length + 1
  const receipt: StoredReceipt = {
    amount: amount.toString(),
    articleId: 'aa'.repeat(32),
    clientRef: n.toString(16).padStart(32, '0'),
    contentHash: 'bb'.repeat(32),
    cumulativeAfter: (BigInt(pair.cumulative) + amount).toString(),
    highlightId: null,
    seq: pair.seq + 1,
  }
  const prepared: PreparedTabTip & { requestId: string } = {
    prepareId: `prep-${n}`,
    requestId: args.requestId,
    tabContractId: FIXTURE_TAB,
    readerAddress: FIXTURE_READER,
    writer: FIXTURE_WRITER,
    keyId: args.keyId,
    seq: pair.seq + 1,
    cumulativeBefore: pair.cumulative,
    amount: amount.toString(),
    receipt,
    leafHashes: [...pair.leaves],
    expiresAt: Date.now() + 300_000,
    existing: false,
  }
  state.prepared[prepared.prepareId] = prepared
  return structuredClone(prepared)
}

export function submitTip(
  state: FixtureState,
  args: { prepareId: string; receipt: StoredReceipt; signature: string },
  onSettle: (receiptId: string) => void
): SubmittedTabTip | { lost: true } {
  state.calls.push('submitTip')
  const prepared = state.prepared[args.prepareId]
  if (!prepared) throw new FixtureError('TAB_PREPARE_NOT_FOUND')
  const done = state.accepted[args.prepareId]
  if (done) {
    if (done.voucher.signature !== args.signature)
      throw new FixtureError('TAB_DUPLICATE_REFERENCE')
    return { ...structuredClone(done), alreadyAccepted: true }
  }
  if (state.submitRefusal && state.submitRefusal.times > 0) {
    state.submitRefusal.times -= 1
    throw new FixtureError(state.submitRefusal.code)
  }
  if (JSON.stringify(args.receipt) !== JSON.stringify(prepared.receipt))
    throw new FixtureError('TAB_RECEIPT_MISMATCH')
  const pairId = `${prepared.keyId}|${prepared.writer}`
  const pair = state.pairs[pairId] ?? { seq: 0, cumulative: '0', leaves: [] }
  if (pair.seq + 1 !== prepared.seq) throw new FixtureError('TAB_STALE_PREPARE')
  const key = state.tab?.keys.find((k) => k.keyId === prepared.keyId)
  if (!key?.publicKey) throw new FixtureError('TAB_KEY_UNKNOWN')
  const leaves = [...pair.leaves, receiptLeafHex(args.receipt)]
  const receiptsRoot = receiptsRootHex(leaves)
  const payload = voucherPayloadFor({
    tabContractId: FIXTURE_TAB,
    networkPassphrase: FIXTURE_PASSPHRASE,
    reader: prepared.readerAddress,
    writer: prepared.writer,
    keyId: prepared.keyId,
    publicKey: hexToBytes(key.publicKey, 32),
    cumulative: args.receipt.cumulativeAfter,
    receiptsRoot,
  })
  if (
    !ed25519.verify(
      hexToBytes(args.signature, 64),
      payload,
      hexToBytes(key.publicKey, 32)
    )
  )
    throw new FixtureError('TAB_INVALID_SIGNATURE')
  state.pairs[pairId] = {
    seq: prepared.seq,
    cumulative: args.receipt.cumulativeAfter,
    leaves,
  }
  const result: SubmittedTabTip = {
    status: 'ACCEPTED',
    receiptId: `rcpt-${args.prepareId}`,
    receipt: args.receipt,
    leafHashes: leaves,
    voucher: {
      tabContractId: FIXTURE_TAB,
      reader: prepared.readerAddress,
      writer: prepared.writer,
      keyId: prepared.keyId,
      publicKey: key.publicKey,
      cumulative: args.receipt.cumulativeAfter,
      receiptsRoot,
      signature: args.signature,
      acceptor: '00'.repeat(32),
      acceptanceSignature: '00'.repeat(64),
    },
    alreadyAccepted: false,
  }
  state.accepted[args.prepareId] = result
  if (state.tab?.tipLimits) {
    const limits = state.tab.tipLimits
    const today = utcDayOf(Date.now())
    const before =
      limits.acceptedDay === today ? BigInt(limits.acceptedToday) : ZERO
    limits.acceptedDay = today
    limits.acceptedToday = (before + BigInt(args.receipt.amount)).toString()
  }
  key.acceptedTotal = (
    BigInt(key.acceptedTotal) + BigInt(args.receipt.amount)
  ).toString()
  state.tips.push(
    tipRow(state.tips.length, 'ACCEPTED', {
      receiptId: result.receiptId,
      amount: args.receipt.amount,
      seq: prepared.seq,
      keyId: prepared.keyId,
      acceptedAt: Date.now(),
      articleTitle: 'Notes on slow reading',
      highlight: false,
    })
  )
  recomputeTab(state)
  if (state.settleAs) onSettle(result.receiptId)
  if (state.loseSubmits > 0) {
    state.loseSubmits -= 1
    return { lost: true }
  }
  return structuredClone(result)
}

export function settleTip(state: FixtureState, receiptId: string): void {
  const row = state.tips.find((t) => t.receiptId === receiptId)
  if (!row || !state.settleAs) return
  row.status = state.settleAs
  if (state.settleAs === 'SETTLED') {
    row.settledTxHash = 'cd'.repeat(32)
    if (state.tab)
      state.tab.confirmedBalance = (
        BigInt(state.tab.confirmedBalance) - BigInt(row.amount)
      ).toString()
  }
  recomputeTab(state)
}

export { recomputeTab }
