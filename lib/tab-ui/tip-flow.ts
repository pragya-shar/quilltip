/**
 * One tab tip, end to end on the client (05-flows-and-admin.md, section 5.6;
 * lib/stellar/v2/tab/README.md, "Tipping from the tab"):
 *
 * 1. `tabs.prepareTip` with a new `requestId`.
 * 2. `signTabTip`: no wallet prompt. On `retry_prepare`, prepare once more
 *    with a new `requestId`. On `stop`, do not sign.
 * 3. `tabs.submitTip`. A lost response (a network error) resubmits the same
 *    `submit` argument, never a new signature. A refusal of the submit (the
 *    balance, a limit, the key or the pair changed) prepares once more from
 *    the start (payment-states.md, matrix note 11).
 * 4. `commitAcceptedTip` after every acceptance.
 *
 * The result is never "settled": the server accepts the tip, and settlement
 * shows later through the receipt status.
 */
import type {
  PreparedTabTip,
  SignTabTipResult,
  StopReason,
  SubmitTipArgs,
  SubmittedTabTip,
} from '@/lib/stellar/v2/tab'
import type { TabTipHighlight } from './types'

export type TabTipInput = {
  articleId: string
  amountCents: number
  keyId: number
  highlight?: TabTipHighlight | null
}

export type TabTipStep = 'preparing' | 'signing' | 'sending'

export type TabTipOutcome =
  | {
      kind: 'accepted'
      receiptId: string
      amount: string
      writer: string
      /** An earlier identical submit was accepted (a lost response). */
      alreadyAccepted: boolean
    }
  /** Convex refused with a `TAB_*` (or other) code. Nothing was paid. */
  | { kind: 'refused'; code: string; message: string | null }
  /** `signTabTip` refused to sign. Nothing was paid. */
  | { kind: 'stopped'; reason: StopReason; message: string }
  /**
   * The submit never got an answer. The tip may have been accepted; the next
   * prepare shows it (the ledger promotes the signed entry).
   */
  | { kind: 'unconfirmed' }
  /** Prepare could not be reached. Nothing was signed. */
  | { kind: 'unreachable' }

export type TabTipDeps = {
  prepareTip(args: TabTipInput & { requestId: string }): Promise<PreparedTabTip>
  submitTip(args: SubmitTipArgs): Promise<SubmittedTabTip>
  sign(prepared: PreparedTabTip): Promise<SignTabTipResult>
  commit(accepted: SubmittedTabTip): Promise<void>
  newRequestId(): string
  onStep?(step: TabTipStep): void
  sleep?(ms: number): Promise<void>
}

/** Resubmits of the same signed voucher after a network error. */
export const SUBMIT_RESENDS = 3
export const RESEND_BACKOFF_MS = [1_000, 2_000, 4_000] as const
/** Network retries of a prepare (same `requestId`, so it is idempotent). */
export const PREPARE_RESENDS = 2

/** Submit refusals that prepare again would not cure: report them. */
const FINAL_SUBMIT_CODES = new Set([
  'TAB_INVALID_SIGNATURE',
  'TAB_RECEIPT_MISMATCH',
  'TAB_DUPLICATE_REFERENCE',
  'UNAUTHENTICATED',
])

/** The `code` of a `ConvexError` (its `data`), or null for other errors. */
export function convexErrorCode(
  error: unknown
): { code: string; message: string | null } | null {
  if (typeof error !== 'object' || error === null) return null
  let data = (error as { data?: unknown }).data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (typeof data !== 'object' || data === null) return null
  const { code, message } = data as { code?: unknown; message?: unknown }
  return typeof code === 'string'
    ? { code, message: typeof message === 'string' ? message : null }
    : null
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

async function prepareWithResend(
  deps: TabTipDeps,
  args: TabTipInput & { requestId: string },
  sleep: (ms: number) => Promise<void>
): Promise<PreparedTabTip | TabTipOutcome> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.prepareTip(args)
    } catch (error) {
      const refusal = convexErrorCode(error)
      if (refusal) return { kind: 'refused', ...refusal }
      if (attempt >= PREPARE_RESENDS) return { kind: 'unreachable' }
      await sleep(RESEND_BACKOFF_MS[attempt] ?? 4_000)
    }
  }
}

function isOutcome(value: unknown): value is TabTipOutcome {
  return typeof value === 'object' && value !== null && 'kind' in value
}

export async function runTabTip(
  deps: TabTipDeps,
  input: TabTipInput
): Promise<TabTipOutcome> {
  const sleep = deps.sleep ?? defaultSleep
  let signRetried = false
  let submitRetried = false

  for (;;) {
    deps.onStep?.('preparing')
    const prepared = await prepareWithResend(
      deps,
      { ...input, requestId: deps.newRequestId() },
      sleep
    )
    if (isOutcome(prepared)) return prepared

    deps.onStep?.('signing')
    const signed = await deps.sign(prepared)
    if (signed.kind === 'retry_prepare') {
      if (signRetried) {
        return {
          kind: 'refused',
          code: 'TAB_RETRY_EXHAUSTED',
          message: null,
        }
      }
      signRetried = true
      continue
    }
    if (signed.kind === 'stop') {
      return { kind: 'stopped', reason: signed.reason, message: signed.message }
    }

    deps.onStep?.('sending')
    let accepted: SubmittedTabTip | null = null
    let refusal: { code: string; message: string | null } | null = null
    for (let attempt = 0; ; attempt++) {
      try {
        accepted = await deps.submitTip(signed.submit)
        break
      } catch (error) {
        refusal = convexErrorCode(error)
        if (refusal) break
        // Lost response: resend the same signed voucher (README, "Errors").
        if (attempt >= SUBMIT_RESENDS) return { kind: 'unconfirmed' }
        await sleep(RESEND_BACKOFF_MS[attempt] ?? 4_000)
      }
    }
    if (accepted) {
      try {
        await deps.commit(accepted)
      } catch {
        // LEDGER_CONFLICT: the next signTabTip applies the ledger rule.
      }
      return {
        kind: 'accepted',
        receiptId: accepted.receiptId,
        amount: accepted.receipt.amount,
        writer: accepted.voucher.writer,
        alreadyAccepted: accepted.alreadyAccepted,
      }
    }
    if (!refusal) return { kind: 'unconfirmed' }
    if (submitRetried || FINAL_SUBMIT_CODES.has(refusal.code)) {
      return { kind: 'refused', ...refusal }
    }
    submitRetried = true
  }
}
