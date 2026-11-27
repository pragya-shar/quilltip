'use client'

/**
 * The payments runtime, mounted once in the root layout so the balance, the
 * device key and tips in flight persist across navigation, and resume after
 * a reload. The send rules (single flight, an error ends one job only, jobs
 * bound to one reader, account changes mid-send) are in
 * `lib/payments/send-queue.ts`. Wallet-free: it reads `balance.session` (keyed by the signed-in
 * user), the reader's first page of `activity.mine`, and this browser's
 * outbox; the signer (session key, local ledger, Stellar SDK) loads with
 * `import()` when the browser is idle and the reader has a balance, so no
 * first load carries it.
 *
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  useConvexAuth,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { centsToBaseUnits } from '@/lib/payments/money'
import {
  OUTBOX_TTL_MS,
  createOutbox,
  type OutboxEntry,
} from '@/lib/payments/outbox'
import { PaymentsRuntimeContext } from '@/lib/payments/runtime'
import type { JobStatus } from '@/lib/payments/tip-machine'
import {
  LiveStateContext,
  liveRuntime,
  type LiveState,
} from '@/lib/payments/live/live-runtime'
import type { DeviceReading, Signer } from '@/lib/payments/live/signer'
import {
  createSendQueue,
  type QueueBinding,
  type QueueContext,
  type SendQueue,
} from '@/lib/payments/send-queue'
import {
  balanceViewOf,
  readerItemsOf,
  unansweredEntries,
  type ActivityEntry,
  type DeviceState,
} from '@/lib/payments/views'

const READER_PAGE = 20
const NO_JOBS: Record<string, JobStatus> = {}
/** How often an unanswered tip is resubmitted while the page is open. */
const RESUME_EVERY_MS = 10_000
const CLOCK_MS = 30_000

let sharedOutbox: ReturnType<typeof createOutbox> | null = null
function outboxStore() {
  sharedOutbox ??= createOutbox()
  return sharedOutbox
}

function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

function whenIdle(run: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(run, { timeout: 1500 })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(run, 200)
  return () => window.clearTimeout(id)
}

export function PaymentsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const session = useQuery(api.balance.session, isAuthenticated ? {} : 'skip')
  const hasBalance = !!session && session.status !== 'none'
  const reader = usePaginatedQuery(
    api.activity.mine,
    isAuthenticated && hasBalance ? { role: 'reader' } : 'skip',
    { initialNumItems: READER_PAGE }
  )
  const prepareTip = useMutation(api.tabs.prepareTip)
  const submitTip = useMutation(api.tabs.submitTip)

  const outbox = outboxStore()
  const outboxVersion = useSyncExternalStore(
    outbox.subscribe,
    outbox.version,
    () => 0
  )
  const userId = session?.userId ?? null
  const entries = useMemo(
    () => (userId ? outbox.list(userId) : []),
    [outbox, userId, outboxVersion] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  )
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => window.clearInterval(id)
  }, [])

  // Everything below belongs to one reader: the user id and the verified
  // address. A change of either (sign-out included) drops the signer, the
  // device reading, the job map and the queue at once.
  const address = session?.status === 'open' ? session.accountAddress : null
  const binding = useMemo<QueueBinding | null>(
    () => (userId && address ? { userId, readerAddress: address } : null),
    [userId, address]
  )
  const bindingKey = binding ? `${binding.userId}|${binding.readerAddress}` : ''

  const [signerState, setSignerState] = useState<{
    key: string
    signer: Signer
  } | null>(null)
  const [readingState, setReadingState] = useState<{
    key: string
    reading: DeviceReading
  } | null>(null)
  const [loadFailed, setLoadFailed] = useState<string | null>(null)
  const signer = signerState?.key === bindingKey ? signerState.signer : null
  const reading = readingState?.key === bindingKey ? readingState.reading : null

  useEffect(() => {
    // Nothing of the previous reader survives a change of reader.
    setSignerState(null)
    setReadingState(null)
    if (!binding) return
    const key = bindingKey
    let alive = true
    const cancel = whenIdle(() => {
      import('@/lib/payments/live/signer')
        .then((m) => {
          if (alive)
            setSignerState({
              key,
              signer: m.createSigner(binding.readerAddress),
            })
        })
        .catch(() => alive && setLoadFailed(key))
    })
    return () => {
      alive = false
      cancel()
    }
  }, [bindingKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const devicesKey = (session?.devices ?? [])
    .map((d) => `${d.keyId}:${d.publicKey}:${d.revoked}:${d.validUntilLedger}`)
    .join(',')
  useEffect(() => {
    if (!signer || !session || session.status !== 'open') return
    if (signer.scope.readerAddress !== address) return
    const key = bindingKey
    let alive = true
    void signer
      .deviceState(session.devices, session.ledger, Date.now())
      .then((reading) => alive && setReadingState({ key, reading }))
    return () => {
      alive = false
    }
  }, [signer, devicesKey, session?.ledger?.sequence]) // eslint-disable-line react-hooks/exhaustive-deps

  const device: DeviceState = !hasBalance
    ? 'unavailable'
    : loadFailed === bindingKey
      ? 'unavailable'
      : !reading
        ? 'loading'
        : reading.state

  // Tips in flight, by request id, for the current reader only.
  const [jobState, setJobState] = useState<{
    key: string
    jobs: Record<string, JobStatus>
  }>({ key: '', jobs: {} })
  const jobs = jobState.key === bindingKey ? jobState.jobs : NO_JOBS

  // What a job sees when it runs: always the latest render.
  const latest = useRef<QueueContext>({
    binding: null,
    signer: null,
    keyId: null,
  })
  latest.current = {
    binding,
    signer,
    keyId: reading?.state === 'ready' ? reading.keyId : null,
  }
  const mutations = useRef({ prepareTip, submitTip })
  mutations.current = { prepareTip, submitTip }

  const queue = useMemo<SendQueue | null>(() => {
    if (!binding) return null
    const key = bindingKey
    const report = (requestId: string, job: JobStatus) =>
      setJobState((state) =>
        state.key === key
          ? { key, jobs: { ...state.jobs, [requestId]: job } }
          : state
      )
    return createSendQueue(binding, {
      context: () => latest.current,
      outbox,
      convex: {
        prepareTip: (args) =>
          mutations.current
            .prepareTip({
              ...args,
              articleId: args.articleId as Id<'articles'>,
            })
            .then((p) => ({ ...p, prepareId: p.prepareId as string })),
        submitTip: (args) =>
          mutations.current
            .submitTip({
              ...args,
              prepareId: args.prepareId as Id<'tips'> | Id<'highlightTips'>,
            })
            .then((a) => ({ ...a, receiptId: a.receiptId as string })),
      },
      newRequestId: () => crypto.randomUUID(),
      report,
    })
  }, [bindingKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setJobState({ key: bindingKey, jobs: {} })
    return () => queue?.dispose()
  }, [queue]) // eslint-disable-line react-hooks/exhaustive-deps

  const setJob = useCallback(
    (requestId: string, job: JobStatus) =>
      setJobState((state) =>
        state.key === bindingKey
          ? { key: bindingKey, jobs: { ...state.jobs, [requestId]: job } }
          : state
      ),
    [bindingKey]
  )

  // Reconcile with the server: drop entries it lists as accepted; expire
  // those whose prepare window has ended.
  const recent = session?.recentRequestIds.join(',') ?? ''
  useEffect(() => {
    if (!session || session.status === 'none') return
    const accepted = new Set(session.recentRequestIds)
    for (const entry of entries) {
      if (accepted.has(entry.requestId)) {
        outbox.remove(entry.requestId)
        setJob(entry.requestId, { status: 'sent' })
      } else if (Date.now() - entry.createdAt > OUTBOX_TTL_MS) {
        outbox.remove(entry.requestId)
        setJob(entry.requestId, { status: 'failed', code: 'EXPIRED' })
      }
    }
  }, [recent, entries]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resume this reader's unanswered tips while the page is open.
  useEffect(() => {
    if (device !== 'ready' || !queue) return
    const resume = () => {
      for (const entry of unansweredEntries(entries, session))
        queue.enqueue(entry)
    }
    resume()
    const id = window.setInterval(resume, RESUME_EVERY_MS)
    return () => window.clearInterval(id)
  }, [device, entries, recent, queue]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback<LiveState['send']>(
    (target, cents, meta, requestId) => {
      if (!session || !binding || !queue) return
      const price = session.prices[0]?.usd ?? 0
      const entry: OutboxEntry = {
        requestId,
        userId: binding.userId,
        articleId: target.articleId,
        passage: target.kind === 'passage' ? target.passage : null,
        amountCents: cents,
        estimate: centsToBaseUnits(cents, price).toString(),
        createdAt: Date.now(),
        meta,
      }
      outbox.put(entry)
      setJob(requestId, { status: 'sending' })
      queue.enqueue(entry)
    },
    [session, binding, queue, outbox, setJob]
  )

  const balance = useMemo(
    () =>
      balanceViewOf({
        authLoading: isLoading,
        signedIn: isAuthenticated,
        session,
        outbox: entries,
        device,
        online,
        now,
      }),
    [isLoading, isAuthenticated, session, entries, device, online, now]
  )
  const readerActivity = useMemo(
    () => ({
      status:
        !hasBalance && session !== undefined
          ? ('ready' as const)
          : reader.status === 'LoadingFirstPage' || session === undefined
            ? ('loading' as const)
            : ('ready' as const),
      items: readerItemsOf({
        entries: reader.results as ActivityEntry[],
        outbox: entries,
        session,
        now,
      }),
      canLoadMore: reader.status === 'CanLoadMore',
      loadMore: () => reader.loadMore(READER_PAGE),
    }),
    [reader, entries, session, now, hasBalance]
  )

  const state = useMemo<LiveState>(
    () => ({ balance, readerActivity, jobs, send, now }),
    [balance, readerActivity, jobs, send, now]
  )

  return (
    <PaymentsRuntimeContext.Provider value={liveRuntime}>
      <LiveStateContext.Provider value={state}>
        {children}
      </LiveStateContext.Provider>
    </PaymentsRuntimeContext.Provider>
  )
}
