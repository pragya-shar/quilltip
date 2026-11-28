/**
 * The page's balance tip queue (`lib/payments/send-queue.ts`) with a fake
 * signer, fake mutations and the real outbox over an in-memory store:
 * single flight, errors that end one job only, a bound on retries, and jobs
 * bound to one reader across sign-out and sign-in.
 */
import { describe, expect, it } from 'vitest'
import { createOutbox, type OutboxEntry } from '../../lib/payments/outbox'
import {
  createSendQueue,
  type QueueBinding,
  type QueueContext,
  type QueueSigner,
} from '../../lib/payments/send-queue'
import type { JobStatus } from '../../lib/payments/tip-machine'
import type { TabTipOutcome } from '../../lib/tab-ui/tip-flow'

const A: QueueBinding = { userId: 'user-a', readerAddress: 'GREADERA' }
const B: QueueBinding = { userId: 'user-b', readerAddress: 'GREADERB' }

function memoryStore() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

let seq = 0
function entry(user: QueueBinding, o: Partial<OutboxEntry> = {}): OutboxEntry {
  seq += 1
  return {
    requestId: `req-${seq}`,
    userId: user.userId,
    articleId: 'article-1',
    passage: null,
    amountCents: 100,
    estimate: '10000000',
    createdAt: Date.now(),
    meta: { articleTitle: 'Article', writerName: 'Ada', href: null },
    ...o,
  }
}

/** A server that accepts each signed submit once, by request id. */
function fakeServer() {
  const accepted = new Map<string, number>()
  const submits: Array<{ user: string; requestId: string }> = []
  return { accepted, submits }
}

type Behaviour = (
  e: OutboxEntry,
  deps: Parameters<QueueSigner['send']>[2]
) => Promise<TabTipOutcome>

function signerFor(
  user: QueueBinding,
  behaviour: Behaviour
): QueueSigner & {
  calls: string[]
} {
  const calls: string[] = []
  return {
    scope: { readerAddress: user.readerAddress },
    calls,
    async send(e, _keyId, deps) {
      calls.push(e.requestId)
      return behaviour(e, deps)
    },
  }
}

/** The usual path: save the signed submit, then the server accepts once. */
function accepting(
  server: ReturnType<typeof fakeServer>,
  user: QueueBinding,
  session: () => QueueBinding | null
): Behaviour {
  return async (e, deps) => {
    deps.saveSubmit(e.requestId, {
      prepareId: `p-${e.requestId}`,
      receipt: {
        amount: e.estimate,
        articleId: 'aa',
        clientRef: e.requestId,
        contentHash: 'cc',
        cumulativeAfter: e.estimate,
        highlightId: null,
        seq: 1,
      },
      signature: `sig-${user.userId}-${e.requestId}`,
    })
    // Convex runs the submit with the auth of this moment.
    if (session()?.userId !== user.userId)
      return { kind: 'refused', code: 'UNAUTHENTICATED', message: null }
    server.submits.push({ user: user.userId, requestId: e.requestId })
    const n = (server.accepted.get(e.requestId) ?? 0) + 1
    server.accepted.set(e.requestId, n)
    return {
      kind: 'accepted',
      receiptId: `r-${e.requestId}`,
      amount: e.estimate,
      writer: 'GWRITER',
      alreadyAccepted: n > 1,
    }
  }
}

function setup(user: QueueBinding, signer: QueueSigner | null) {
  const outbox = createOutbox(memoryStore())
  const reports: Array<[string, JobStatus]> = []
  const ctx: { current: QueueContext } = {
    current: { binding: user, signer, keyId: 0 },
  }
  const make = (binding: QueueBinding) =>
    createSendQueue(binding, {
      context: () => ctx.current,
      outbox,
      convex: {
        prepareTip: async () => {
          throw new Error('unused by the fake signer')
        },
        submitTip: async () => {
          throw new Error('unused by the fake signer')
        },
      },
      newRequestId: () => `fresh-${++seq}`,
      report: (id, job) => reports.push([id, job]),
    })
  return { outbox, reports, ctx, make }
}

const last = (reports: Array<[string, JobStatus]>, id: string) =>
  [...reports].reverse().find(([r]) => r === id)?.[1]

describe('one job, one outcome', () => {
  it('ends only the job whose signer throws; the next tip sends', async () => {
    const server = fakeServer()
    let throwNext = true
    const signer = signerFor(A, async (e, deps) => {
      if (throwNext) {
        throwNext = false
        throw new Error('IndexedDB failed')
      }
      return accepting(server, A, () => A)(e, deps)
    })
    const { outbox, reports, make } = setup(A, signer)
    const q = make(A)
    const first = entry(A)
    const second = entry(A)
    outbox.put(first)
    outbox.put(second)
    q.enqueue(first)
    q.enqueue(second)
    await q.idle()
    // Nothing was signed for the first: removed and shown as failed.
    expect(last(reports, first.requestId)).toEqual({
      status: 'failed',
      code: 'ERROR',
    })
    expect(outbox.list(A.userId).map((e) => e.requestId)).toEqual([
      second.requestId,
    ])
    expect(last(reports, second.requestId)).toEqual({ status: 'sent' })
    expect(server.accepted.get(second.requestId)).toBe(1)
  })

  it('keeps a tip whose signer throws after saving its submit, and resumes it once', async () => {
    const server = fakeServer()
    let throwNext = true
    const signer = signerFor(A, async (e, deps) => {
      if (e.submit) return accepting(server, A, () => A)(e, deps)
      await accepting(server, A, () => A)(e, deps) // reached the server
      if (throwNext) {
        throwNext = false
        throw new Error('the answer was lost in a callback')
      }
      throw new Error('unreachable')
    })
    const { outbox, reports, make } = setup(A, signer)
    const q = make(A)
    const tip = entry(A)
    outbox.put(tip)
    q.enqueue(tip)
    await q.idle()
    expect(last(reports, tip.requestId)).toEqual({ status: 'sending' })
    expect(outbox.list(A.userId)[0]?.submit?.signature).toBe(
      `sig-user-a-${tip.requestId}`
    )
    // The resume resubmits the saved submit: the server replays, once.
    q.enqueue(outbox.list(A.userId)[0]!)
    await q.idle()
    expect(last(reports, tip.requestId)).toEqual({ status: 'sent' })
    expect(server.accepted.get(tip.requestId)).toBe(2)
    expect(
      server.submits.filter((s) => s.requestId === tip.requestId)
    ).toHaveLength(2)
  })

  it('stops running a tip that always throws, and still sends the others', async () => {
    const server = fakeServer()
    const doomed = entry(A, { articleId: 'broken' })
    const signer = signerFor(A, async (e, deps) => {
      if (e.articleId === 'broken') {
        deps.saveSubmit(e.requestId, {
          prepareId: 'p',
          receipt: {
            amount: '1',
            articleId: 'aa',
            clientRef: 'c',
            contentHash: 'cc',
            cumulativeAfter: '1',
            highlightId: null,
            seq: 1,
          },
          signature: 's',
        })
        throw new Error('always')
      }
      return accepting(server, A, () => A)(e, deps)
    })
    const { outbox, reports, make } = setup(A, signer)
    const q = make(A)
    outbox.put(doomed)
    for (let i = 0; i < 10; i++) q.enqueue(outbox.list(A.userId)[0]!)
    await q.idle()
    for (let i = 0; i < 10; i++) {
      q.enqueue(outbox.list(A.userId).find((e) => e.articleId === 'broken')!)
      await q.idle()
    }
    // Three attempts at most, then this page stops; the entry stays.
    expect(signer.calls.filter((id) => id === doomed.requestId)).toHaveLength(3)
    expect(last(reports, doomed.requestId)).toEqual({
      status: 'failed',
      code: 'UNCONFIRMED',
    })
    expect(q.enqueue(outbox.list(A.userId)[0]!)).toBe(false)
    const other = entry(A)
    outbox.put(other)
    expect(q.enqueue(other)).toBe(true)
    await q.idle()
    expect(last(reports, other.requestId)).toEqual({ status: 'sent' })
  })

  it('survives a throw inside saveSubmit or renameRequest', async () => {
    const server = fakeServer()
    const signer = signerFor(A, async (e, deps) => {
      if (e.articleId === 'rename') deps.renameRequest(e.requestId, 'renamed')
      return accepting(server, A, () => A)(e, deps)
    })
    const { outbox, reports, make } = setup(A, signer)
    const realUpdate = outbox.update
    let failUpdates = 2
    outbox.update = (id, patch) => {
      if (failUpdates-- > 0) throw new Error('storage quota')
      return realUpdate(id, patch)
    }
    const q = make(A)
    const a = entry(A, { articleId: 'rename' })
    const b = entry(A)
    const c = entry(A)
    for (const e of [a, b, c]) outbox.put(e)
    for (const e of [a, b, c]) q.enqueue(e)
    await expect(q.idle()).resolves.toBeUndefined()
    expect(last(reports, a.requestId)).toEqual({
      status: 'failed',
      code: 'ERROR',
    })
    expect(last(reports, b.requestId)).toEqual({
      status: 'failed',
      code: 'ERROR',
    })
    expect(last(reports, c.requestId)).toEqual({ status: 'sent' })
  })
})

describe('jobs bound to one reader', () => {
  it('keeps reader A apart from reader B across sign-out, and sends A once on return', async () => {
    const server = fakeServer()
    const session: { user: QueueBinding | null } = { user: A }
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const signerA = signerFor(A, async (e, deps) => {
      if (e.articleId === 'mid-flight' && !e.submit) {
        // Signed and saved; the answer arrives after the sign-out.
        deps.saveSubmit(e.requestId, {
          prepareId: `p-${e.requestId}`,
          receipt: {
            amount: e.estimate,
            articleId: 'aa',
            clientRef: e.requestId,
            contentHash: 'cc',
            cumulativeAfter: e.estimate,
            highlightId: null,
            seq: 1,
          },
          signature: `sig-user-a-${e.requestId}`,
        })
        await gate
        return { kind: 'refused', code: 'UNAUTHENTICATED', message: null }
      }
      return accepting(server, A, () => session.user)(e, deps)
    })
    const { outbox, reports, ctx, make } = setup(A, signerA)
    const qA = make(A)
    const flying = entry(A, { articleId: 'mid-flight' })
    const queued = entry(A)
    outbox.put(flying)
    outbox.put(queued)
    qA.enqueue(flying)
    qA.enqueue(queued)

    // A signs out mid-flight, then B signs in with B's own key (key id 0 too).
    session.user = null
    ctx.current = { binding: null, signer: null, keyId: null }
    qA.dispose()
    release()
    await qA.idle()
    // A's entries are intact: nothing sent, nothing removed.
    expect(
      outbox
        .list(A.userId)
        .map((e) => e.requestId)
        .sort()
    ).toEqual([flying.requestId, queued.requestId].sort())
    expect(server.submits).toHaveLength(0)

    session.user = B
    const signerB = signerFor(
      B,
      accepting(server, B, () => session.user)
    )
    ctx.current = { binding: B, signer: signerB, keyId: 0 }
    const qB = make(B)
    // B's queue refuses A's entries; B sees none of them.
    expect(qB.enqueue(flying)).toBe(false)
    expect(outbox.list(B.userId)).toEqual([])
    const bTip = entry(B)
    outbox.put(bTip)
    qB.enqueue(bTip)
    await qB.idle()
    expect(signerB.calls).toEqual([bTip.requestId])
    expect(signerA.calls).not.toContain(bTip.requestId)
    expect(server.submits).toEqual([
      { user: 'user-b', requestId: bTip.requestId },
    ])

    // A signs in again: each of A's tips is accepted exactly once.
    session.user = A
    qB.dispose()
    const signerA2 = signerFor(
      A,
      accepting(server, A, () => session.user)
    )
    ctx.current = { binding: A, signer: signerA2, keyId: 0 }
    const qA2 = make(A)
    for (const e of outbox.list(A.userId)) qA2.enqueue(e)
    await qA2.idle()
    expect(server.accepted.get(flying.requestId)).toBe(1)
    expect(server.accepted.get(queued.requestId)).toBe(1)
    // The resumed tip carried the signature A made before the sign-out.
    expect(
      outbox.list(A.userId).find((e) => e.requestId === flying.requestId)
        ?.submit?.signature
    ).toBe(`sig-user-a-${flying.requestId}`)
    expect(last(reports, flying.requestId)).toEqual({ status: 'sent' })
  })

  it('does nothing when the signer belongs to another reader', async () => {
    const server = fakeServer()
    const signerB = signerFor(
      B,
      accepting(server, B, () => B)
    )
    const { outbox, make, ctx } = setup(A, signerB)
    const q = make(A)
    const tip = entry(A)
    outbox.put(tip)
    q.enqueue(tip)
    await q.idle()
    expect(signerB.calls).toEqual([])
    expect(outbox.list(A.userId)).toHaveLength(1)
    // And nothing while the device key is not read yet.
    ctx.current = {
      binding: A,
      signer: signerFor(
        A,
        accepting(server, A, () => A)
      ),
      keyId: null,
    }
    q.enqueue(tip)
    await q.idle()
    expect(server.submits).toEqual([])
  })
})

describe('the queue survives what the job does not catch', () => {
  it('runs the next tip after a job throws outside its signer', async () => {
    const server = fakeServer()
    const signer = signerFor(
      A,
      accepting(server, A, () => A)
    )
    const store = memoryStore()
    const real = createOutbox(store)
    let failNextList = false
    // Storage throws once, inside the job but before the signer runs.
    const outbox = {
      ...real,
      list: (userId: string) => {
        if (failNextList) {
          failNextList = false
          throw new Error('storage unavailable')
        }
        return real.list(userId)
      },
    }
    const queue = createSendQueue(A, {
      context: () => ({ binding: A, signer, keyId: 0 }),
      outbox,
      convex: {
        prepareTip: async () => {
          throw new Error('unused')
        },
        submitTip: async () => {
          throw new Error('unused')
        },
      },
      newRequestId: () => `fresh-${++seq}`,
      report: () => {},
    })
    const first = entry(A)
    const second = entry(A)
    real.put(first)
    real.put(second)
    failNextList = true
    queue.enqueue(first)
    queue.enqueue(second)
    await queue.idle().catch(() => {})
    expect(signer.calls).toEqual([second.requestId])
    expect(server.accepted.get(second.requestId)).toBe(1)
  })
})

describe('a job is bound to its user, not only to its address', () => {
  it("never runs reader A's tip for another user signed in on the same address", async () => {
    const C: QueueBinding = { userId: 'user-c', readerAddress: A.readerAddress }
    const server = fakeServer()
    const signerC = signerFor(
      C,
      accepting(server, C, () => C)
    )
    const { outbox, ctx, make } = setup(A, null)
    let mutations = 0
    const queue = createSendQueue(A, {
      context: () => ctx.current,
      outbox,
      convex: {
        prepareTip: async () => {
          mutations += 1
          throw new Error('must not be called')
        },
        submitTip: async () => {
          mutations += 1
          throw new Error('must not be called')
        },
      },
      newRequestId: () => `fresh-${++seq}`,
      report: () => {},
    })
    void make
    const tip = entry(A)
    outbox.put(tip)
    // User C signed in on the same reader address before the job ran.
    ctx.current = { binding: C, signer: signerC, keyId: 0 }
    expect(queue.enqueue(tip)).toBe(true)
    await queue.idle()
    expect(signerC.calls).toEqual([])
    expect(mutations).toBe(0)
    expect(server.submits).toEqual([])
    // A's entry stays, untouched, for A's return.
    expect(outbox.list(A.userId).map((e) => e.requestId)).toEqual([
      tip.requestId,
    ])
  })
})
