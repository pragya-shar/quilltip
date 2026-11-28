/**
 * Maps failures to kit states, in one place for every flow: wallet errors,
 * decoded contract errors, `sendContractCall` outcomes and the Convex `TAB_*`
 * refusal codes (docs/design-system/payment-states.md, "Mapping").
 *
 * Type-only imports from `lib/stellar/v2`, so a page that renders the kit
 * loads no v2 payment code. Copy lives in lib/copy/payment-states.ts.
 */
import type { V2ErrorInfo } from '@/lib/stellar/v2/errors'
import type { WalletErrorKind } from '@/lib/stellar/v2/wallet-errors'
import {
  FAILURE_COPY,
  TAB_REFUSAL_COPY,
  WALLET_FAILURE_COPY,
  WRONG_ACCOUNT_AFTER_SIGNING,
  WRONG_ACCOUNT_BEFORE_SIGNING,
  type CopyBlock,
} from '@/lib/copy/payment-states'
import type { TipsUnavailableReason, WalletGateState } from './ui-state'
import { shortAddress } from './format'

export type PaymentFailure = { title: string; detail: string }

/** The fields of `V2ErrorInfo` the kit reads. */
export type ContractFailureLike = Pick<
  V2ErrorInfo,
  'code' | 'name' | 'contract' | 'message'
>

/** The fields of a `WalletError` the kit reads. */
export type WalletFailureLike = {
  kind: WalletErrorKind
  /** Network passphrase the wallet reported (wrong-network only). */
  walletPassphrase?: string
  /** wrong-account before signing: who must sign, and the wallet's account. */
  expectedAddress?: string
  walletAddress?: string
}

// Wallet -----------------------------------------------------------------------

/** "Testnet", "Mainnet" … for a network passphrase (as `networkLabel`). */
export function walletNetworkLabel(passphrase: string | undefined): string {
  if (!passphrase) return 'another network'
  if (passphrase.startsWith('Test SDF Network')) return 'Testnet'
  if (passphrase.startsWith('Public Global Stellar Network')) return 'Mainnet'
  if (passphrase.startsWith('Test SDF Future Network')) return 'Futurenet'
  if (passphrase.startsWith('Standalone Network')) return 'a local network'
  return 'another network'
}

/**
 * The gate state for a wallet failure, or `null` when the failure belongs in
 * the progress view instead (declined, timed out, pop-up blocked, wrong
 * account). A connection the wallet ended goes back to the gate, because
 * the next step is to connect again.
 */
export function gateFromWalletError(
  error: WalletFailureLike
): WalletGateState | null {
  switch (error.kind) {
    case 'no-wallet':
      return { kind: 'no-wallet' }
    case 'locked':
      return { kind: 'locked' }
    case 'wrong-network':
      return {
        kind: 'wrong-network',
        walletNetwork: walletNetworkLabel(error.walletPassphrase),
      }
    case 'disconnected':
      return { kind: 'disconnected', ended: true }
    default:
      return null
  }
}

/**
 * Failure copy for a wallet error raised while signing. The title is fixed
 * per kind; the wallet's own text is never shown. `cancelled` returns
 * `null`: closing the picker is not an error.
 */
export function failureFromWalletError(
  error: WalletFailureLike
): PaymentFailure | null {
  if (error.kind === 'cancelled') return null
  // Found before the wallet was asked to sign: name the linked address.
  if (
    error.kind === 'wrong-account' &&
    error.expectedAddress &&
    error.walletAddress
  ) {
    return WRONG_ACCOUNT_BEFORE_SIGNING(
      shortAddress(error.expectedAddress),
      shortAddress(error.walletAddress)
    )
  }
  // Found after the wallet answered: name the linked address when the
  // caller gave it.
  if (error.kind === 'wrong-account' && error.expectedAddress) {
    return WRONG_ACCOUNT_AFTER_SIGNING(shortAddress(error.expectedAddress))
  }
  // The map covers every kind at compile time; a value outside the type at
  // run time still gets the generic copy.
  return WALLET_FAILURE_COPY[error.kind] ?? WALLET_FAILURE_COPY.failed
}

// Contract ---------------------------------------------------------------------

export type ContractNotice =
  | { kind: 'paused' }
  | { kind: 'insufficient-balance'; source: 'wallet' }
  | { kind: 'tips-unavailable'; reason: TipsUnavailableReason }
  | { kind: 'basket-item-unavailable' }
  | { kind: 'session-key-missing' }
  | { kind: 'withdrawal-pending' }

/** Binding names (from `V2ErrorInfo.name`) that become a notice. */
const PAUSE = 'EnforcedPause'
const LOW_BALANCE = new Set([
  'BalanceError',
  'InsufficientAccountReserve',
  'InsufficientFeeBalance',
])

/**
 * A notice for a decoded contract or send failure, or `null` when the
 * failure shows as a plain "Not sent" result. Decoding uses the contract
 * that raised the code (lib/stellar/v2/errors.ts), so a token balance error
 * is never read as a Core error.
 */
export function noticeFromContractFailure(
  failure: ContractFailureLike,
  options: { batch?: boolean } = {}
): ContractNotice | null {
  if (failure.name === PAUSE) return { kind: 'paused' }
  if (failure.name && LOW_BALANCE.has(failure.name)) {
    return { kind: 'insufficient-balance', source: 'wallet' }
  }
  if (failure.contract === 'core' && failure.name === 'NotRegistered') {
    return options.batch
      ? { kind: 'basket-item-unavailable' }
      : { kind: 'tips-unavailable', reason: 'unregistered' }
  }
  if (failure.contract === 'tab' && failure.name === 'KeyNotFound') {
    return { kind: 'session-key-missing' }
  }
  if (failure.contract === 'tab' && failure.name === 'WithdrawLocked') {
    return { kind: 'withdrawal-pending' }
  }
  return null
}

/**
 * "Not sent" copy for a decoded contract or send failure with no notice of
 * its own. The title stays fixed; the decoded message is the detail.
 */
export function failureFromContract(
  failure: ContractFailureLike
): PaymentFailure {
  const { detail } = FAILURE_COPY.notSent
  const message = failure.message.trim()
  return {
    title: FAILURE_COPY.notSent.title,
    detail: message.endsWith(detail) ? message : `${message} ${detail}`,
  }
}

// Transaction outcomes ---------------------------------------------------------

/** `TxOutcome` from lib/stellar/v2/tx.ts, structurally. */
export type TxOutcomeLike =
  | { status: 'simulation_failed'; error: ContractFailureLike; detail: string }
  | { status: 'wallet_failed'; error: WalletFailureLike }
  | { status: 'send_error'; error: ContractFailureLike; detail: string }
  | { status: 'sent'; hash: string }
  | { status: 'not_sent'; detail: string }

/** What `chain.submissions.recordSendFailed` takes, or null when nothing is recorded. */
export type RecordFailureReason =
  | 'simulation_failed'
  | 'send_error'
  | 'wallet_rejected'

export type TxOutcomeView = {
  /**
   * - `sent`: keep the progress view; the record decides from here.
   * - `declined`: the wallet refused; show the `declined` phase.
   * - `cancelled`: the picker was closed; return to the start form.
   * - `failed`: show `failed` with `failure` once the record is `FAILED`.
   * - `gate`: show the wallet gate; nothing was signed.
   * - `notice`: show the notice; nothing was signed.
   */
  show:
    | { kind: 'sent'; hash: string }
    | { kind: 'declined' }
    | { kind: 'cancelled' }
    | { kind: 'failed'; failure: PaymentFailure }
    | { kind: 'gate'; gate: WalletGateState }
    | { kind: 'notice'; notice: ContractNotice }
  /**
   * Report to `recordSendFailed` so the record becomes `FAILED` and a retry
   * with a new `requestId` is allowed. `detail` is a short code, never
   * wallet text.
   */
  record: { reason: RecordFailureReason; detail?: string } | null
}

/**
 * One mapping for every `sendContractCall` outcome, so the three flows show
 * and record the same thing. Retry stays the record's decision: it is
 * offered after the record reaches `FAILED` or `EXPIRED`.
 */
export function viewFromTxOutcome(
  outcome: TxOutcomeLike,
  options: { batch?: boolean } = {}
): TxOutcomeView {
  switch (outcome.status) {
    case 'sent':
      return { show: { kind: 'sent', hash: outcome.hash }, record: null }
    case 'wallet_failed': {
      const { kind } = outcome.error
      const record = { reason: 'wallet_rejected' as const, detail: kind }
      if (kind === 'cancelled') return { show: { kind: 'cancelled' }, record }
      if (kind === 'rejected') return { show: { kind: 'declined' }, record }
      const gate = gateFromWalletError(outcome.error)
      if (gate) return { show: { kind: 'gate', gate }, record }
      return {
        show: {
          kind: 'failed',
          failure: failureFromWalletError(outcome.error)!,
        },
        record,
      }
    }
    case 'simulation_failed':
    case 'send_error': {
      const record = {
        reason: outcome.status,
        ...(outcome.error.name ? { detail: outcome.error.name } : {}),
      }
      const notice = noticeFromContractFailure(outcome.error, options)
      if (notice) return { show: { kind: 'notice', notice }, record }
      return {
        show: { kind: 'failed', failure: failureFromContract(outcome.error) },
        record,
      }
    }
    case 'not_sent':
      return {
        show: { kind: 'failed', failure: FAILURE_COPY.notSentBusy },
        record: { reason: 'send_error', detail: 'TRY_AGAIN_LATER' },
      }
  }
}

// Convex tab refusals ----------------------------------------------------------

export type TabRefusal =
  | { kind: 'notice'; notice: TabNotice }
  | { kind: 'gate'; gate: WalletGateState }
  | { kind: 'tips-unavailable'; reason: TipsUnavailableReason }
  /** A plain refusal: the server accepted nothing; the start form stays. */
  | { kind: 'refused'; copy: CopyBlock }

export type TabNotice =
  | { kind: 'insufficient-balance'; source: 'tab' }
  | { kind: 'session-key-none' }
  | { kind: 'session-key-expired' }
  | { kind: 'key-limit' }
  | { kind: 'daily-limit' }
  | { kind: 'tab-none' }
  | { kind: 'tab-closing' }

const TAB_REFUSALS: Record<string, TabRefusal> = {
  TAB_OVER_BALANCE: {
    kind: 'notice',
    notice: { kind: 'insufficient-balance', source: 'tab' },
  },
  TAB_OVER_KEY_LIMIT: { kind: 'notice', notice: { kind: 'key-limit' } },
  TAB_RECEIPT_CAP: { kind: 'notice', notice: { kind: 'key-limit' } },
  TAB_DAILY_LIMIT: { kind: 'notice', notice: { kind: 'daily-limit' } },
  TAB_KEY_EXPIRED: { kind: 'notice', notice: { kind: 'session-key-expired' } },
  TAB_KEY_UNKNOWN: { kind: 'notice', notice: { kind: 'session-key-none' } },
  TAB_KEY_REVOKED: { kind: 'notice', notice: { kind: 'session-key-none' } },
  TAB_PAIR_CLOSED: { kind: 'notice', notice: { kind: 'session-key-none' } },
  TAB_NO_ACCOUNT: { kind: 'notice', notice: { kind: 'tab-none' } },
  TAB_CLOSED: { kind: 'notice', notice: { kind: 'tab-none' } },
  TAB_CLOSING: { kind: 'notice', notice: { kind: 'tab-closing' } },
  TAB_READER_UNVERIFIED: { kind: 'gate', gate: { kind: 'unverified' } },
  TAB_ARTICLE_HAS_SPLITS: { kind: 'tips-unavailable', reason: 'splits' },
  TAB_ARTICLE_NOT_REGISTERED: {
    kind: 'tips-unavailable',
    reason: 'unregistered',
  },
  TAB_ARTICLE_UNKNOWN: { kind: 'tips-unavailable', reason: 'unregistered' },
  TAB_WRITER_UNVERIFIED: {
    kind: 'tips-unavailable',
    reason: 'payout_outdated',
  },
  TAB_ABOVE_TIP_MAX: { kind: 'refused', copy: TAB_REFUSAL_COPY.aboveMax },
  TAB_BELOW_MINIMUM: { kind: 'refused', copy: TAB_REFUSAL_COPY.belowMinimum },
  TAB_INVALID_AMOUNT: { kind: 'refused', copy: TAB_REFUSAL_COPY.belowMinimum },
  TAB_SELF_TIP: { kind: 'refused', copy: TAB_REFUSAL_COPY.selfTip },
  TAB_PRICE_UNAVAILABLE: { kind: 'refused', copy: TAB_REFUSAL_COPY.noPrice },
  TAB_RECONCILE_PENDING: { kind: 'refused', copy: TAB_REFUSAL_COPY.checking },
  TAB_PREPARE_EXPIRED: { kind: 'refused', copy: TAB_REFUSAL_COPY.timedOut },
  TAB_PREPARE_NOT_FOUND: { kind: 'refused', copy: TAB_REFUSAL_COPY.timedOut },
  TAB_STALE_PREPARE: { kind: 'refused', copy: TAB_REFUSAL_COPY.timedOut },
  TAB_DUPLICATE_REFERENCE: {
    kind: 'refused',
    copy: TAB_REFUSAL_COPY.duplicate,
  },
  TAB_NO_WITHDRAWAL: { kind: 'refused', copy: TAB_REFUSAL_COPY.noWithdrawal },
  TAB_ACCEPTOR_UNAVAILABLE: {
    kind: 'refused',
    copy: TAB_REFUSAL_COPY.unavailable,
  },
  TAB_CHAIN_STATE_UNKNOWN: {
    kind: 'refused',
    copy: TAB_REFUSAL_COPY.unavailable,
  },
  TAB_ACCEPTOR_MISMATCH: {
    kind: 'refused',
    copy: TAB_REFUSAL_COPY.unavailable,
  },
  TAB_CONTRACT_MISMATCH: {
    kind: 'refused',
    copy: TAB_REFUSAL_COPY.unavailable,
  },
  TAB_EPOCH_CURRENT: { kind: 'refused', copy: TAB_REFUSAL_COPY.unavailable },
  TAB_CONFIG_INVALID: { kind: 'refused', copy: TAB_REFUSAL_COPY.unavailable },
  TAB_ACCOUNT_OTHER_USER: {
    kind: 'refused',
    copy: TAB_REFUSAL_COPY.otherAccount,
  },
  TAB_INVALID_SIGNATURE: {
    kind: 'refused',
    copy: TAB_REFUSAL_COPY.badVoucher,
  },
  TAB_RECEIPT_MISMATCH: { kind: 'refused', copy: TAB_REFUSAL_COPY.badVoucher },
}

/** The Convex `TAB_*` codes the kit maps; a unit test compares it with convex/. */
export const TAB_REFUSAL_CODES: readonly string[] = Object.keys(TAB_REFUSALS)

/**
 * The kit state for a `ConvexError` code from `convex/tabs.ts`. An unknown
 * code is a plain refusal with generic copy.
 */
export function refusalFromTabError(code: string): TabRefusal {
  return (
    TAB_REFUSALS[code] ?? { kind: 'refused', copy: TAB_REFUSAL_COPY.generic }
  )
}
