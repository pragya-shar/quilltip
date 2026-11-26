/**
 * The client state of one v2 tip flow (article, highlight or basket), as a
 * pure reducer. It holds only what the client knows: the request in flight,
 * the wallet step, a refusal to show with the form, and the submission it
 * follows. The server record (`tipsV2.getTipStatus`) decides every result;
 * `progressSource` hands both to the payment kit, which derives the phase
 * (docs/design-system/payment-states.md).
 */
import type {
  ClientStep,
  ProgressSource,
  WalletGateState,
} from '@/lib/payments/ui-state'
import type {
  ContractNotice,
  PaymentFailure,
  TxOutcomeView,
} from '@/lib/payments/failures'
import type { CopyBlock } from '@/lib/copy/payment-states'
import type { TipsUnavailableReason } from '@/lib/copy/tips-unavailable'
import type { MappedRefusal } from './prepare-errors'

/** A standing condition shown with the form, or instead of it. */
export type FlowCondition =
  | { kind: 'gate'; gate: WalletGateState }
  | { kind: 'paused' }
  | { kind: 'tips-unavailable'; reason: TipsUnavailableReason }
  | { kind: 'basket-item-unavailable'; itemIndex: number | null }
  | {
      kind: 'insufficient-balance'
      /** Base units the tip needs, before the network fee. */
      needed?: string
      /** Base units the wallet can spend. */
      available?: string
    }
  | { kind: 'network-busy' }
  | { kind: 'refused'; copy: CopyBlock; amountField: boolean }

export type TipFlowState = {
  stage: 'form' | 'preparing' | 'tracking'
  /** The `requestId` of the prepare in flight or last made. */
  requestId: string | null
  submissionId: string | null
  /** The wallet step the client is in, while the record is `PREPARED`. */
  step: ClientStep | null
  /** The wallet refused the request. */
  declined: boolean
  /** Copy for a `failed` result the client caused (wallet, contract, check). */
  failure: PaymentFailure | null
  txHash: string | null
  condition: FlowCondition | null
}

export type TipFlowEvent =
  | { type: 'start'; requestId: string }
  | { type: 'prepared'; submissionId: string }
  | { type: 'refused'; refusal: MappedRefusal }
  | { type: 'step'; step: ClientStep }
  | { type: 'check_failed'; failure: PaymentFailure }
  | { type: 'outcome'; view: TxOutcomeView }
  /** The transaction was accepted but its result is not known yet. */
  | { type: 'pending_elsewhere' }
  | { type: 'resume'; submissionId: string; txHash: string | null }
  | {
      type: 'balance'
      needed: string | undefined
      available: string | undefined
    }
  | { type: 'dismiss' }
  | { type: 'reset' }

export const INITIAL_FLOW: TipFlowState = {
  stage: 'form',
  requestId: null,
  submissionId: null,
  step: null,
  declined: false,
  failure: null,
  txHash: null,
  condition: null,
}

function conditionFromRefusal(refusal: MappedRefusal): FlowCondition {
  switch (refusal.kind) {
    case 'gate':
      return { kind: 'gate', gate: refusal.gate }
    case 'paused':
      return { kind: 'paused' }
    case 'tips-unavailable':
      return { kind: 'tips-unavailable', reason: refusal.reason }
    case 'basket-item-unavailable':
      return { kind: 'basket-item-unavailable', itemIndex: refusal.itemIndex }
    case 'refused':
      return {
        kind: 'refused',
        copy: refusal.copy,
        amountField: refusal.amountField,
      }
  }
}

function conditionFromNotice(notice: ContractNotice): FlowCondition {
  switch (notice.kind) {
    case 'paused':
      return { kind: 'paused' }
    case 'insufficient-balance':
      return { kind: 'insufficient-balance' }
    case 'tips-unavailable':
      return { kind: 'tips-unavailable', reason: notice.reason }
    case 'basket-item-unavailable':
      return { kind: 'basket-item-unavailable', itemIndex: null }
    // Tab notices never come from a Core tip; show the plain refusal.
    default:
      return {
        kind: 'refused',
        copy: {
          title: 'Not sent',
          detail: 'Nothing was paid. Try again in a minute.',
        },
        amountField: false,
      }
  }
}

export function tipFlowReducer(
  state: TipFlowState,
  event: TipFlowEvent
): TipFlowState {
  switch (event.type) {
    case 'start':
      if (state.stage === 'preparing') return state
      return {
        ...INITIAL_FLOW,
        stage: 'preparing',
        requestId: event.requestId,
      }
    case 'prepared':
      if (state.stage !== 'preparing') return state
      return {
        ...state,
        stage: 'tracking',
        submissionId: event.submissionId,
        step: 'simulating',
      }
    case 'refused':
      if (state.stage !== 'preparing') return state
      return {
        ...INITIAL_FLOW,
        requestId: state.requestId,
        condition: conditionFromRefusal(event.refusal),
      }
    case 'step':
      if (state.stage !== 'tracking') return state
      return { ...state, step: event.step }
    case 'check_failed':
      if (state.stage !== 'tracking') return state
      return { ...state, step: null, failure: event.failure }
    case 'outcome': {
      if (state.stage !== 'tracking') return state
      const show = event.view.show
      switch (show.kind) {
        case 'sent':
          return { ...state, step: null, txHash: show.hash }
        case 'declined':
          return { ...state, step: null, declined: true }
        case 'failed':
          return { ...state, step: null, failure: show.failure }
        case 'cancelled':
          // Closing the picker is not an error: back to the form.
          return { ...INITIAL_FLOW, requestId: state.requestId }
        case 'gate':
          return {
            ...INITIAL_FLOW,
            requestId: state.requestId,
            condition: { kind: 'gate', gate: show.gate },
          }
        case 'notice':
          return {
            ...INITIAL_FLOW,
            requestId: state.requestId,
            condition: conditionFromNotice(show.notice),
          }
      }
      return state
    }
    case 'pending_elsewhere':
      if (state.stage !== 'tracking') return state
      return { ...state, step: null }
    case 'resume':
      return {
        ...INITIAL_FLOW,
        stage: 'tracking',
        submissionId: event.submissionId,
        txHash: event.txHash,
      }
    case 'balance':
      if (state.condition?.kind !== 'insufficient-balance') return state
      return {
        ...state,
        condition: {
          kind: 'insufficient-balance',
          ...(event.needed ? { needed: event.needed } : {}),
          ...(event.available ? { available: event.available } : {}),
        },
      }
    case 'dismiss':
      return { ...state, condition: null }
    case 'reset':
      return INITIAL_FLOW
  }
}

/** The status fields of `getTipStatus` the progress view reads. */
export type TipRecordView = {
  status: string
  mismatchReason: string | null
  needsReview: boolean
  items: ReadonlyArray<{ status: string; mismatchReason: string | null }>
}

/**
 * The kit's progress source for the flow, or null while the form shows.
 * `record` is `undefined` while the query loads, `null` when the server has
 * no such record for this account.
 */
export function progressSource(
  state: TipFlowState,
  record: TipRecordView | null | undefined,
  options: { batch?: boolean } = {}
): ProgressSource | null {
  if (state.stage === 'form') return null
  if (state.stage === 'preparing') return { clientStep: 'simulating' }
  const client = {
    step: state.step,
    declined: state.declined,
  }
  if (!record) {
    // Loading: show the live step, or that the client is checking.
    return state.step
      ? { clientStep: state.step }
      : { record: { status: 'PREPARED' }, ...client }
  }
  const base = {
    status: record.status,
    mismatchReason: record.mismatchReason,
    needsReview: record.needsReview,
  }
  return options.batch && record.items.length > 1
    ? {
        record: base,
        rows: record.items.map((item) => ({
          status: item.status,
          mismatchReason: item.mismatchReason,
        })),
        ...client,
      }
    : { record: base, ...client }
}

/** A server `uiState` after which the record will not change again. */
export function isFinalUiState(uiState: string | null | undefined): boolean {
  return (
    uiState === 'confirmed' ||
    uiState === 'mismatch_author' ||
    uiState === 'mismatch_review' ||
    uiState === 'failed' ||
    uiState === 'expired'
  )
}

/** Money may have moved: the tip is done and must not be sent again. */
export function moneyMayHaveMoved(uiState: string | null | undefined): boolean {
  return (
    uiState === 'confirmed' ||
    uiState === 'mismatch_author' ||
    uiState === 'mismatch_review'
  )
}

/** A new `requestId` for each prepare (and each retry). */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
