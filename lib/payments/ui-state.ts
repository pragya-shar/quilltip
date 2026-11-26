/**
 * Maps server record statuses, wallet failures and contract failures to the
 * UI states of the shared payment kit (docs/design-system/payment-states.md).
 *
 * Pure functions with no Convex, wallet or React imports, so the flow code
 * and the unit tests can use them anywhere. The server decides confirmation
 * (docs/architecture/v2/06-app-integration.md, section 6.1); these functions
 * only translate what it reports.
 */
import type {
  ChainRecordStatus,
  TabReceiptStatus,
} from '@/convex/lib/chain/schema'
import {
  networkLabel,
  walletErrorMessage,
  type WalletError,
  type WalletErrorKind,
} from '@/lib/stellar/v2/wallet-errors'

export type { ChainRecordStatus }

/** One row of the state matrix: every user payment flow in v2. */
export type PaymentFlow =
  | 'direct-tip'
  | 'highlight-tip'
  | 'tip-basket'
  | 'tab-open'
  | 'tab-top-up'
  | 'tab-tip'
  | 'tab-new-key'
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
  'tab-close',
  'tab-withdraw',
  'collect',
  'settle-own',
  'nft-mint',
  'nft-transfer',
]

/** Steps the client runs itself before the server takes over. */
export type ClientStep = 'simulating' | 'signing' | 'sending'

/** Tab tip (receipt) statuses (section 6.1, "Status sets"). */
export type TabTipStatus = TabReceiptStatus

export type PaymentPhase =
  | ClientStep
  /** `PREPARED` or `SUBMITTED` with no live client step: the server decides. */
  | 'checking'
  | 'confirmed'
  /** `MISMATCH` with reason `author`: paid to the on-chain author. */
  | 'sent-to-registered'
  /** `MISMATCH` with `field:*` or `no_event`, or a `REJECTED` tab tip. */
  | 'under-review'
  | 'failed'
  | 'expired'
  /** Tab tip accepted by the server; settles on chain later. */
  | 'accepted'
  | 'settled'
  | 'shortfall'
  | 'unpaid'
  | 'void-reset'

export const WALLET_STEPS: readonly (ClientStep | 'checking')[] = [
  'simulating',
  'signing',
  'sending',
  'checking',
]

const FINAL: ReadonlySet<PaymentPhase> = new Set<PaymentPhase>([
  'confirmed',
  'sent-to-registered',
  'under-review',
  'failed',
  'expired',
  'settled',
  'unpaid',
  'void-reset',
])

/** True when the phase will not change without a new user action. */
export function isFinalPhase(phase: PaymentPhase): boolean {
  return FINAL.has(phase)
}

/**
 * Retry is offered only after `FAILED` or `EXPIRED` (section 6.1, rule 3).
 * Never after `MISMATCH`: money may have moved (I-24).
 */
export function canRetry(phase: PaymentPhase): boolean {
  return phase === 'failed' || phase === 'expired'
}

/**
 * The phase for a direct tip, batch or chain submission record. A final
 * server status always wins. Otherwise a live client step (the user is in
 * the wallet prompt) is shown, and with none the UI shows "checking": an
 * unresolved record stays "checking" until the server marks it `EXPIRED`.
 */
export function phaseFromRecord(
  record: { status: ChainRecordStatus; mismatchReason?: string | null },
  clientStep?: ClientStep | null
): PaymentPhase {
  switch (record.status) {
    case 'CONFIRMED':
      return 'confirmed'
    case 'MISMATCH':
      return record.mismatchReason === 'author'
        ? 'sent-to-registered'
        : 'under-review'
    case 'FAILED':
      return 'failed'
    case 'EXPIRED':
      return 'expired'
    case 'PREPARED':
      return clientStep ?? 'checking'
    case 'SUBMITTED':
      return 'checking'
  }
}

export function phaseFromTabTip(status: TabTipStatus): PaymentPhase {
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
      return 'under-review'
    case 'VOID_RESET':
      return 'void-reset'
  }
}

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

/**
 * The gate state for a wallet failure, or `null` when the failure belongs in
 * the transaction progress instead (declined, timed out, wrong account).
 */
export function gateFromWalletError(
  error: Pick<WalletError, 'kind' | 'walletPassphrase'>
): WalletGateState | null {
  switch (error.kind) {
    case 'no-wallet':
      return { kind: 'no-wallet' }
    case 'locked':
      return { kind: 'locked' }
    case 'wrong-network':
      return {
        kind: 'wrong-network',
        walletNetwork: networkLabel(error.walletPassphrase),
      }
    default:
      return null
  }
}

export type PaymentFailure = { title: string; detail?: string }

/**
 * Failure copy for a wallet error raised while signing. `cancelled` returns
 * `null`: closing the picker is not an error. Nothing was signed in any of
 * these cases, so the flow may offer "Try again".
 */
export function failureFromWalletError(
  error: WalletError
): PaymentFailure | null {
  return walletErrorMessage(error)
}

/** Wallet error kinds the gate handles rather than the progress view. */
export const GATE_WALLET_ERRORS: readonly WalletErrorKind[] = [
  'no-wallet',
  'locked',
  'wrong-network',
]

/**
 * Structural match for `V2ErrorInfo` in `lib/stellar/v2/errors.ts` (the
 * decoded contract failure), so this module does not depend on it.
 */
export type ContractFailureLike = {
  code: number | null
  name: string | null
  message: string
}

/** Contract codes that become a notice rather than a plain failure. */
export const NOTICE_CODES = {
  enforcedPause: 1000,
  notRegistered: 1,
  keyNotFound: 35,
  withdrawLocked: 41,
} as const

export type ContractNotice =
  | { kind: 'paused' }
  | { kind: 'insufficient-balance'; source: 'wallet' }
  | { kind: 'tips-unavailable'; reason: 'unregistered' }
  | { kind: 'session-key-missing' }
  | { kind: 'withdrawal-pending' }

/**
 * A notice for a decoded contract failure, or `null` when the failure shows
 * as a plain "Not sent" message. `raw` is the simulation or result text; the
 * insufficient-balance case carries no contract code.
 */
export function noticeFromContractFailure(
  failure: ContractFailureLike,
  raw = ''
): ContractNotice | null {
  switch (failure.code) {
    case NOTICE_CODES.enforcedPause:
      return { kind: 'paused' }
    case NOTICE_CODES.notRegistered:
      return { kind: 'tips-unavailable', reason: 'unregistered' }
    case NOTICE_CODES.keyNotFound:
      return { kind: 'session-key-missing' }
    case NOTICE_CODES.withdrawLocked:
      return { kind: 'withdrawal-pending' }
  }
  if (
    failure.code === null &&
    /insufficient|underfunded/i.test(`${raw} ${failure.message}`)
  ) {
    return { kind: 'insufficient-balance', source: 'wallet' }
  }
  return null
}

/**
 * "Not sent" copy for a decoded contract or send failure that has no notice
 * of its own. `FAILED` means no payment was applied (section 6.1, rule 3).
 */
export function failureFromContract(
  failure: ContractFailureLike
): PaymentFailure {
  return { title: 'Not sent', detail: `${failure.message} Nothing was paid.` }
}
