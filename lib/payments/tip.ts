/**
 * One balance tip from an outbox entry: prepare, sign with this browser's
 * key (no wallet prompt), submit, commit to the local ledger. Built on
 * `runTabTip` (`lib/tab-ui/tip-flow.ts`); this layer adds what survives a
 * reload:
 *
 * - The first prepare uses the entry's `requestId`, so a resumed send
 *   prepares the same tip. If the ledger rule asks for a fresh prepare, the
 *   entry is renamed to the new `requestId` before it is used.
 * - The signed `submitTip` argument is saved on the entry before it is sent;
 *   a resume resubmits exactly that (the server replays its acceptance).
 *
 * The outcome is never "settled": the server accepts, and settlement shows
 * later in the activity list.
 */
import type {
  PreparedTabTip,
  SignTabTipResult,
  SubmitTipArgs,
  SubmittedTabTip,
} from '@/lib/stellar/v2/tab'
import {
  RESEND_BACKOFF_MS,
  SUBMIT_RESENDS,
  convexErrorCode,
  runTabTip,
  type TabTipOutcome,
} from '@/lib/tab-ui/tip-flow'
import type { OutboxEntry, SignedSubmit } from './outbox'

export type BalanceTipDeps = {
  prepareTip(args: {
    requestId: string
    articleId: string
    amountCents: number
    keyId: number
    highlight?: OutboxEntry['passage']
  }): Promise<PreparedTabTip>
  submitTip(args: SubmitTipArgs): Promise<SubmittedTabTip>
  sign(prepared: PreparedTabTip): Promise<SignTabTipResult>
  commit(accepted: SubmittedTabTip): Promise<void>
  newRequestId(): string
  /** Persists the signed submit on the entry before it is sent. */
  saveSubmit(requestId: string, submit: SignedSubmit): void
  /** The entry now carries another request id (a fresh prepare). */
  renameRequest(from: string, to: string): void
  sleep?(ms: number): Promise<void>
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

async function resubmit(
  entry: OutboxEntry & { submit: SignedSubmit },
  deps: BalanceTipDeps
): Promise<TabTipOutcome> {
  const sleep = deps.sleep ?? defaultSleep
  for (let attempt = 0; ; attempt++) {
    try {
      const accepted = await deps.submitTip(entry.submit)
      try {
        await deps.commit(accepted)
      } catch {
        // The next signTabTip applies the ledger rule.
      }
      return {
        kind: 'accepted',
        receiptId: accepted.receiptId,
        amount: accepted.receipt.amount,
        writer: accepted.voucher.writer,
        alreadyAccepted: accepted.alreadyAccepted,
      }
    } catch (error) {
      const refusal = convexErrorCode(error)
      if (refusal) return { kind: 'refused', ...refusal }
      if (attempt >= SUBMIT_RESENDS) return { kind: 'unconfirmed' }
      await sleep(RESEND_BACKOFF_MS[attempt] ?? 4_000)
    }
  }
}

export async function sendBalanceTip(
  entry: OutboxEntry,
  keyId: number,
  deps: BalanceTipDeps
): Promise<TabTipOutcome> {
  if (entry.submit) return resubmit({ ...entry, submit: entry.submit }, deps)
  let current = entry.requestId
  let first = true
  return runTabTip(
    {
      prepareTip: deps.prepareTip,
      submitTip: async (args) => {
        deps.saveSubmit(current, args as SignedSubmit)
        return deps.submitTip(args)
      },
      sign: deps.sign,
      commit: deps.commit,
      newRequestId: () => {
        if (first) {
          first = false
          return current
        }
        const next = deps.newRequestId()
        deps.renameRequest(current, next)
        current = next
        return next
      },
      sleep: deps.sleep,
    },
    {
      articleId: entry.articleId,
      amountCents: entry.amountCents,
      keyId,
      highlight: entry.passage,
    }
  )
}
