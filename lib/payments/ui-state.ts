/**
 * The state model of the shared payment kit
 * (docs/design-system/payment-states.md): server records, tab tips, tab
 * operations and batches become one `PaymentPhase`, and
 * `resolvePaymentView` decides what a flow renders.
 *
 * Pure functions with no Convex, wallet or React imports. Imports from
 * `lib/stellar/v2` and `convex/` are type-only, so a page that renders the
 * kit loads none of that code (the first-load rule, scripts/perf). The
 * server decides confirmation (docs/architecture/v2/06-app-integration.md,
 * section 6.1); these functions only translate what it reports.
 */
import type {
  ChainRecordStatus,
  TabReceiptStatus,
} from '@/convex/lib/chain/schema'

import type { TipsUnavailableReason } from '@/lib/copy/tips-unavailable'

export type { ChainRecordStatus, TabReceiptStatus }

/** One row of the state matrix: every user payment flow in v2. */
export type PaymentFlow =
  | 'direct-tip'
  | 'highlight-tip'
  | 'tip-basket'
  | 'tab-open'
  | 'tab-top-up'
  | 'tab-tip'
  | 'tab-new-key'
  | 'tab-revoke-key'
  | 'tab-close'
  | 'tab-withdraw'
  | 'collect'
  | 'settle-own'
  | 'nft-mint'
  | 'nft-transfer'

export const PAYMENT_FLOWS: readonly PaymentFlow[] = [
  'direct-tip',
  'highlight-tip',
  'tip-basket',
  'tab-open',
  'tab-top-up',
  'tab-tip',
  'tab-new-key',
  'tab-revoke-key',
  'tab-close',
  'tab-withdraw',
  'collect',
  'settle-own',
  'nft-mint',
  'nft-transfer',
]

/** Steps the client runs itself (lib/stellar/v2/tx.ts `TxStep`). */
export type ClientStep = 'simulating' | 'signing' | 'sending'

export type PaymentPhase =
  | ClientStep
  /** `SUBMITTED`: the transaction was sent; the server decides. */
  | 'checking'
  /**
   * `PREPARED` with no live client step (for example after a reload), or a
   * status the kit does not know. Nothing is claimed as done.
   */
  | 'resuming'
  /** Client only: the wallet refused. The flow records `wallet_rejected`. */
  | 'declined'
  | 'confirmed'
  /** `MISMATCH` with reason `author`: paid to the on-chain author. */
  | 'sent-to-registered'
  /** `MISMATCH` with `field:*` or `no_event`. Money may have moved. */
  | 'under-review'
  | 'failed'
  | 'expired'
  /** Tab tip accepted by the server; settles on chain later. */
  | 'accepted'
  | 'settled'
  | 'shortfall'
  | 'unpaid'
  /** Tab tip excluded by the settler; nothing ran on chain for it. */
  | 'rejected'
  | 'void-reset'

/** Phases shown as a running step rather than a result panel. */
export type RunningPhase = ClientStep | 'checking' | 'resuming'

export const RUNNING_PHASES: ReadonlySet<PaymentPhase> = new Set<PaymentPhase>([
  'simulating',
  'signing',
  'sending',
  'checking',
  'resuming',
])

export function isRunning(phase: PaymentPhase): phase is RunningPhase {
  return RUNNING_PHASES.has(phase)
}

/** The four steps of a wallet-signed transaction, in order. */
export const WALLET_STEPS: readonly (ClientStep | 'checking')[] = [
  'simulating',
  'signing',
  'sending',
  'checking',
]

/** Phases after which "Try again" may be offered, if the record allows it. */
const RETRY_PHASES: ReadonlySet<PaymentPhase> = new Set<PaymentPhase>([
  'failed',
  'expired',
  'declined',
])

/**
 * The phase allows a retry. Never after `MISMATCH`: money may have moved
 * (I-24). The record must allow it too: see `deriveProgress`.
 */
export function phaseAllowsRetry(phase: PaymentPhase): boolean {
  return RETRY_PHASES.has(phase)
}

// Server records ---------------------------------------------------------------

/**
 * A direct tip, batch or chain submission record as Convex returns it.
 * `status` is a string: `tips.status` also holds v1 values, and an unknown
 * value must not break the view.
 */
export type ChainRecord = {
  status: ChainRecordStatus | (string & {})
  mismatchReason?: string | null
  /** Set by the server for records that may hold a payment that landed. */
  needsReview?: boolean
}

export type ClientState = {
  /** The step the client is running now, from `onStep`. */
  step?: ClientStep | null
  /** The wallet refused the request (`wallet_failed`, kind `rejected`). */
  declined?: boolean
}

/**
 * The phase for a server record. A final server status always wins, except
 * that a wallet refusal the client saw reads as `declined`. A live client
 * step shows only while the record is `PREPARED`. `PREPARED` with no step is
 * `resuming`: the client does not know whether anything was signed or sent.
 */
export function phaseFromRecord(
  record: ChainRecord,
  client: ClientState = {}
): PaymentPhase {
  switch (record.status) {
    case 'CONFIRMED':
      return 'confirmed'
    case 'MISMATCH':
      return record.mismatchReason === 'author'
        ? 'sent-to-registered'
        : 'under-review'
    case 'FAILED':
      return client.declined ? 'declined' : 'failed'
    case 'EXPIRED':
      return 'expired'
    case 'PREPARED':
      if (client.declined) return 'declined'
      return client.step ?? 'resuming'
    case 'SUBMITTED':
      return 'checking'
    default:
      return 'resuming'
  }
}

/**
 * "Try again" for a record: only after `FAILED` or `EXPIRED` (section 6.1,
 * rule 3), never when the server flags the record for review, and never
 * while a wallet refusal is not yet recorded (the record is still
 * `PREPARED`).
 */
export function recordAllowsRetry(record: ChainRecord): boolean {
  return (
    (record.status === 'FAILED' || record.status === 'EXPIRED') &&
    record.needsReview !== true
  )
}

/** A row of a batch record (`getSubmissionStatus().rows`). */
export type BatchRow = { status: string; mismatchReason?: string | null }

/**
 * The phase of a basket payment from its rows. Any row under review puts the
 * whole payment under review. When every row is confirmed, some of them paid
 * to an updated payout address, the payment reads as confirmed and
 * `redirected` counts those rows. Otherwise the record decides.
 */
export function phaseFromBatch(
  record: ChainRecord,
  rows: readonly BatchRow[],
  client: ClientState = {}
): { phase: PaymentPhase; redirected: number } {
  const phases = rows.map((row) => phaseFromRecord(row))
  if (phases.includes('under-review')) {
    return { phase: 'under-review', redirected: 0 }
  }
  const redirected = phases.filter((p) => p === 'sent-to-registered').length
  if (
    phases.length > 0 &&
    phases.every((p) => p === 'confirmed' || p === 'sent-to-registered')
  ) {
    return { phase: 'confirmed', redirected }
  }
  return { phase: phaseFromRecord(record, client), redirected: 0 }
}

/** The phase for a tab tip (receipt) status. Unknown values read as `resuming`. */
export function phaseFromTabTip(
  status: TabReceiptStatus | (string & {})
): PaymentPhase {
  switch (status) {
    case 'ACCEPTED':
      return 'accepted'
    case 'SETTLED':
      return 'settled'
    case 'SHORTFALL':
      return 'shortfall'
    case 'UNPAID':
      return 'unpaid'
    case 'REJECTED':
      return 'rejected'
    case 'VOID_RESET':
      return 'void-reset'
    default:
      return 'resuming'
  }
}

// Tab operations ---------------------------------------------------------------

/**
 * Tab operations have no server record: the indexer applies their events to
 * the tab account and its keys (`getMyTab`). They confirm only when that
 * state shows the change.
 */
export type TabOperation =
  | { flow: 'tab-open' }
  /** `before` is `confirmedBalance` when the top-up started. */
  | { flow: 'tab-top-up'; before: string }
  | { flow: 'tab-new-key'; keyId: string }
  | { flow: 'tab-revoke-key'; keyId: string }
  | { flow: 'tab-close' }
  | { flow: 'tab-withdraw' }

/** The fields of `tabs.getMyTab` that confirm a tab operation. */
export type TabSnapshot = {
  status: 'OPEN' | 'CLOSING' | 'CLOSED' | (string & {})
  confirmedBalance: string
  keys: readonly { keyId: string; revoked: boolean }[]
} | null

function bigintOf(value: string): bigint | null {
  return /^\d+$/.test(value) ? BigInt(value) : null
}

/** True when the indexed tab state shows the operation took effect. */
export function tabOperationApplied(
  operation: TabOperation,
  tab: TabSnapshot
): boolean {
  if (!tab) return false
  switch (operation.flow) {
    case 'tab-open':
      return tab.status === 'OPEN'
    case 'tab-top-up': {
      const now = bigintOf(tab.confirmedBalance)
      const before = bigintOf(operation.before)
      return now !== null && before !== null && now > before
    }
    case 'tab-new-key':
      return tab.keys.some((k) => k.keyId === operation.keyId && !k.revoked)
    case 'tab-revoke-key':
      return tab.keys.some((k) => k.keyId === operation.keyId && k.revoked)
    case 'tab-close':
      return tab.status === 'CLOSING'
    case 'tab-withdraw':
      return tab.status === 'CLOSED'
  }
}

export type TabOperationClient = ClientState & {
  /** `sendContractCall` returned `sent`. */
  sent?: boolean
  /** The UI-only `pollTransaction` result, once known. */
  poll?: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | null
}

/**
 * The phase of a tab operation. Indexed state confirms it. RPC `FAILED`
 * means nothing moved; a poll timeout means the transaction can no longer
 * be included. Both allow a retry, and a late indexer update still turns
 * the view confirmed, because the state check runs first.
 */
export function phaseFromTabOperation(
  operation: TabOperation,
  tab: TabSnapshot,
  client: TabOperationClient = {}
): PaymentPhase {
  if (tabOperationApplied(operation, tab)) return 'confirmed'
  if (client.declined) return 'declined'
  if (client.poll === 'FAILED') return 'failed'
  if (client.poll === 'TIMEOUT') return 'expired'
  if (client.sent) return 'checking'
  return client.step ?? 'resuming'
}

// Progress ---------------------------------------------------------------------

/** Where the progress view gets its phase. The view derives it; flows never pass `confirmed`. */
export type ProgressSource =
  | ({ record: ChainRecord; rows?: readonly BatchRow[] } & ClientState)
  | { tabTip: { status: string } }
  | ({ tabOperation: TabOperation; tab: TabSnapshot } & TabOperationClient)
  /** Before prepare returns a record, or a tab tip while it is sent. */
  | { clientStep: ClientStep }

export type DerivedProgress = {
  phase: PaymentPhase
  /** The record allows "Try again" (new `requestId`). */
  retry: boolean
  /** Basket rows paid to an updated payout address. */
  redirected: number
}

export function deriveProgress(source: ProgressSource): DerivedProgress {
  if ('record' in source) {
    const { phase, redirected } = source.rows
      ? phaseFromBatch(source.record, source.rows, source)
      : { phase: phaseFromRecord(source.record, source), redirected: 0 }
    return {
      phase,
      redirected,
      retry: phaseAllowsRetry(phase) && recordAllowsRetry(source.record),
    }
  }
  if ('tabTip' in source) {
    return {
      phase: phaseFromTabTip(source.tabTip.status),
      retry: false,
      redirected: 0,
    }
  }
  if ('tabOperation' in source) {
    const phase = phaseFromTabOperation(source.tabOperation, source.tab, source)
    return { phase, retry: phaseAllowsRetry(phase), redirected: 0 }
  }
  return { phase: source.clientStep, retry: false, redirected: 0 }
}

// Wallet gate ------------------------------------------------------------------

/** What stands between the user and a wallet-signed action. */
export type WalletGateState =
  | { kind: 'ready' }
  /** The wallet adapter is restoring a session. */
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  /** No Stellar wallet is installed in this browser. */
  | { kind: 'no-wallet' }
  /** A wallet exists but this site is not connected to it. */
  | { kind: 'disconnected' }
  | { kind: 'locked' }
  /** `walletNetwork` is a human label such as "Mainnet". */
  | { kind: 'wrong-network'; walletNetwork?: string }
  /** Connected, but the address is not proven to belong to this account. */
  | { kind: 'unverified'; address?: string }

export type WalletGateKind = WalletGateState['kind']

// Standing conditions ----------------------------------------------------------

export type { TipsUnavailableReason }

/** Standing conditions that `PaymentNotice` renders, without their data. */
export type NoticeKind =
  | 'paused'
  | 'insufficient-balance'
  | 'session-key-none'
  | 'session-key-missing'
  | 'session-key-expired'
  | 'key-limit'
  | 'daily-limit'
  | 'tab-none'
  | 'tab-closing'
  | 'settlement-delayed'
  | 'withdrawal-pending'
  | 'withdrawal-ready'
  | 'close-tab-warning'
  | 'basket-item-unavailable'
  | 'nft-threshold'
  | 'network-busy'
  | 'refused'

/** Notices that block starting a new payment (the start button is hidden). */
const BLOCKING_NOTICES: ReadonlySet<NoticeKind> = new Set<NoticeKind>([
  'paused',
  'session-key-none',
  'session-key-missing',
  'session-key-expired',
  'key-limit',
  'daily-limit',
  'tab-none',
  'tab-closing',
  'withdrawal-pending',
])

export type PaymentCondition =
  | { kind: 'tips-unavailable'; reason: TipsUnavailableReason }
  | { kind: 'gate'; gate: WalletGateState }
  | { kind: 'notice'; notice: { kind: NoticeKind } }

export type PaymentViewInput = {
  /** The payment in flight or finished, or null before one starts. */
  source: ProgressSource | null
  gate: WalletGateState
  /** A standing condition such as a pause, a short balance or a key limit. */
  notice?: { kind: NoticeKind } | null
  tipsUnavailable?: TipsUnavailableReason | null
}

export type PaymentView = {
  /** Render `TransactionProgress` whenever this is set. */
  progress: DerivedProgress | null
  /**
   * The one standing condition to show. With a payment in progress it
   * renders above the progress view, never instead of it.
   */
  condition: PaymentCondition | null
  /** Render the start form (amount and start button). */
  showStart: boolean
  /** The start button may run. */
  canStart: boolean
  /** Offer "Try again" on the progress view. */
  canRetry: boolean
}

/**
 * One precedence rule for every flow. A payment in progress or finished
 * always renders. Standing conditions, in order tips unavailable, paused,
 * wallet gate, any other notice, only block starting a new payment or a
 * retry.
 */
export function resolvePaymentView(input: PaymentViewInput): PaymentView {
  const progress = input.source ? deriveProgress(input.source) : null
  const notice = input.notice ?? null
  let condition: PaymentCondition | null = null
  if (input.tipsUnavailable) {
    condition = { kind: 'tips-unavailable', reason: input.tipsUnavailable }
  } else if (notice?.kind === 'paused') {
    condition = { kind: 'notice', notice }
  } else if (input.gate.kind !== 'ready') {
    condition = { kind: 'gate', gate: input.gate }
  } else if (notice) {
    condition = { kind: 'notice', notice }
  }
  const blocksStart =
    condition !== null &&
    (condition.kind !== 'notice' || BLOCKING_NOTICES.has(condition.notice.kind))
  const showStart = progress === null && !blocksStart
  return {
    progress,
    condition,
    showStart,
    canStart: showStart && condition === null,
    canRetry: progress !== null && progress.retry && condition === null,
  }
}

// Settlement -------------------------------------------------------------------

/**
 * A small tab pair is due 6 h after its oldest receipt and the settler runs
 * every 10 minutes (spec 3.8), so a tip is routinely unsettled just past
 * 6 h. The delay notice waits for 8 h: the due time plus two settler runs
 * and the transaction.
 */
export const SETTLEMENT_DELAYED_AFTER_MS = 8 * 60 * 60 * 1000

/** True when the oldest accepted, unsettled tab tip is late. */
export function isSettlementDelayed(
  oldestAcceptedAt: number | null,
  now: number
): boolean {
  return (
    oldestAcceptedAt !== null &&
    now - oldestAcceptedAt > SETTLEMENT_DELAYED_AFTER_MS
  )
}
