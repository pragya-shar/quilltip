/**
 * The page's queue of balance tips, one per signed-in reader. Pure logic
 * with its collaborators injected, so the rules below are unit-tested
 * (`scripts/payments/balance-send-queue.test.ts`).
 *
 * Rules:
 *
 * 1. **Single flight.** Jobs run one at a time, so two taps never prepare
 *    the same pair at once.
 * 2. **An error ends one job only.** Every job catches its own errors and
 *    the chain link always resolves, so a throw never stops later tips.
 *    A job that throws after its signed submit was saved is left in the
 *    outbox for resume (it may have reached the server); one that throws
 *    before is removed and reported failed (nothing was signed, so nothing
 *    can be accepted). A tip whose job keeps throwing is not run again in
 *    this page after `maxErrors` attempts; it stays in the outbox until the
 *    server lists it or its prepare window ends.
 * 3. **Bound to one reader.** A queue is created for one user id and reader
 *    address. A job runs only while the current session, the reader address
 *    and the signer's key scope all still equal its own; otherwise it does
 *    nothing and the entry stays, untouched, in that user's outbox.
 * 4. **Account change mid-send.** Convex runs each mutation with the auth of
 *    that moment. A submit that lands before sign-out is accepted for the
 *    reader who signed it; one sent after is refused. Either way the job,
 *    once the account changed, leaves the entry as it is: its saved signed
 *    submit is resubmitted unchanged when that reader signs in again within
 *    the prepare window (the server replays an acceptance, never a second
 *    one), and otherwise it expires and reads as not sent. So each tip is
 *    accepted at most once, whatever the order.
 */
import type { TabTipOutcome } from '@/lib/tab-ui/tip-flow'
import type { Outbox, OutboxEntry } from './outbox'
import type { BalanceTipDeps } from './tip'
import type { JobStatus } from './tip-machine'

export type QueueBinding = { userId: string; readerAddress: string }

export type QueueSigner = {
  scope: { readerAddress: string }
  send(
    entry: OutboxEntry,
    keyId: number,
    deps: Omit<BalanceTipDeps, 'sign' | 'commit'>
  ): Promise<TabTipOutcome>
}

/** What the page holds at the moment a job runs. */
export type QueueContext = {
  binding: QueueBinding | null
  signer: QueueSigner | null
  /** This device's key id, from a reading of the current reader's keys. */
  keyId: number | null
}

export type SendQueueDeps = {
  context(): QueueContext
  outbox: Pick<Outbox, 'list' | 'update' | 'remove'>
  convex: Pick<BalanceTipDeps, 'prepareTip' | 'submitTip'>
  newRequestId(): string
  report(requestId: string, job: JobStatus): void
  /**
   * Whether a job may start now, read when it starts, not when it was
   * queued: a job queued behind one in flight starts later, and by then the
   * session may name someone else (the engine passes its binding check).
   * False leaves the entry in the outbox for its own reader's next resume.
   */
  mayStart?(): boolean
  /** Throwing attempts per tip before this page stops running it. */
  maxErrors?: number
}

export type SendQueue = {
  binding: QueueBinding
  /** Queues the entry; false when it is not this queue's or not runnable. */
  enqueue(entry: OutboxEntry): boolean
  /** Resolves when every queued job has finished. Never rejects. */
  idle(): Promise<void>
  dispose(): void
}

export const MAX_JOB_ERRORS = 3

/** Refusals that mean "not now", not "not this tip": keep the entry. */
const KEEP_ON_REFUSAL = new Set(['UNAUTHENTICATED'])

export function createSendQueue(
  binding: QueueBinding,
  deps: SendQueueDeps
): SendQueue {
  const maxErrors = deps.maxErrors ?? MAX_JOB_ERRORS
  let tail: Promise<void> = Promise.resolve()
  let disposed = false
  const queued = new Set<string>()
  const errors = new Map<string, number>()

  /** The context, if it still belongs to this queue's reader. */
  const bound = (): QueueContext | null => {
    if (disposed) return null
    const c = deps.context()
    return c.binding?.userId === binding.userId &&
      c.binding.readerAddress === binding.readerAddress &&
      c.signer?.scope.readerAddress === binding.readerAddress
      ? c
      : null
  }
  const find = (requestId: string) =>
    deps.outbox.list(binding.userId).find((e) => e.requestId === requestId)

  async function job(entry: OutboxEntry): Promise<void> {
    const c = bound()
    if (!c || c.keyId === null) return
    if (deps.mayStart && !deps.mayStart()) return
    const fresh = find(entry.requestId)
    if (!fresh) return
    let current = fresh.requestId
    // The control waits on the id it sent; a fresh prepare renames the entry.
    const report = (job: JobStatus) => {
      deps.report(fresh.requestId, job)
      if (current !== fresh.requestId) deps.report(current, job)
    }
    let outcome: TabTipOutcome
    try {
      outcome = await c.signer!.send(fresh, c.keyId, {
        ...deps.convex,
        newRequestId: deps.newRequestId,
        saveSubmit: (requestId, submit) =>
          deps.outbox.update(requestId, { submit }),
        renameRequest: (from, to) => {
          deps.outbox.update(from, { requestId: to })
          current = to
        },
      })
    } catch {
      const n = (errors.get(fresh.requestId) ?? 0) + 1
      errors.set(fresh.requestId, n)
      if (current !== fresh.requestId) errors.set(current, n)
      if (!bound()) return
      let saved: OutboxEntry | undefined
      try {
        saved = find(current)
      } catch {
        saved = undefined
      }
      if (saved?.submit) {
        // It may have reached the server: leave it for resume.
        report(
          n >= maxErrors
            ? { status: 'failed', code: 'UNCONFIRMED' }
            : { status: 'sending' }
        )
        return
      }
      deps.outbox.remove(current)
      report({ status: 'failed', code: 'ERROR' })
      return
    }
    if (!bound()) return
    if (outcome.kind === 'accepted') {
      report({ status: 'sent' })
      return
    }
    if (outcome.kind === 'unconfirmed') return
    if (outcome.kind === 'refused' && KEEP_ON_REFUSAL.has(outcome.code)) return
    deps.outbox.remove(current)
    report({
      status: 'failed',
      code:
        outcome.kind === 'refused'
          ? outcome.code
          : outcome.kind === 'stopped'
            ? `STOPPED_${outcome.reason}`
            : 'UNREACHABLE',
    })
  }

  return {
    binding,
    enqueue(entry) {
      if (disposed || entry.userId !== binding.userId) return false
      if (queued.has(entry.requestId)) return false
      if ((errors.get(entry.requestId) ?? 0) >= maxErrors) return false
      queued.add(entry.requestId)
      tail = tail
        .then(() => job(entry))
        .catch(() => {
          // A job never rejects the queue; its own catch reported it.
        })
        .finally(() => {
          queued.delete(entry.requestId)
        })
      return true
    },
    idle: () => tail,
    dispose() {
      disposed = true
    },
  }
}
