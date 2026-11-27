'use client'

/**
 * The payments runtime, mounted once in the root layout so the balance, the
 * device key and tips in flight persist across navigation, and resume after
 * a reload. Wallet-free: it reads `balance.session` (keyed by the signed-in
 * user), the reader's first page of `activity.mine`, and this browser's
 * outbox; the signer (session key, local ledger, Stellar SDK) loads with
 * `import()` when the browser is idle and the reader has a balance, so no
 * first load carries it.
 *
 * Sends are single flight: one queue per page, so two taps or two controls
 * never prepare the same pair at once.
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
  balanceViewOf,
  readerItemsOf,
  unansweredEntries,
  type ActivityEntry,
  type DeviceState,
} from '@/lib/payments/views'

const READER_PAGE = 20
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

  // The signer: loaded once per reader address, when the browser is idle.
  const address = session?.status === 'open' ? session.accountAddress : null
  const [signer, setSigner] = useState<Signer | null>(null)
  const [reading, setReading] = useState<DeviceReading | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  useEffect(() => {
    if (!address || (signer && signer.scope.readerAddress === address)) return
    return whenIdle(() => {
      import('@/lib/payments/live/signer')
        .then((m) => setSigner(m.createSigner(address)))
        .catch(() => setLoadFailed(true))
    })
  }, [address, signer])

  const devicesKey = (session?.devices ?? [])
    .map((d) => `${d.keyId}:${d.publicKey}:${d.revoked}:${d.validUntilLedger}`)
    .join(',')
  useEffect(() => {
    if (!signer || !session || session.status !== 'open') return
    let alive = true
    void signer
      .deviceState(session.devices, session.ledger, Date.now())
      .then((r) => alive && setReading(r))
    return () => {
      alive = false
    }
  }, [signer, devicesKey, session?.ledger?.sequence]) // eslint-disable-line react-hooks/exhaustive-deps

  const device: DeviceState = !hasBalance
    ? 'unavailable'
    : loadFailed
      ? 'unavailable'
      : !reading
        ? 'loading'
        : reading.state

  // Tips in flight, by request id.
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({})
  const setJob = useCallback((requestId: string, job: JobStatus) => {
    setJobs((all) => ({ ...all, [requestId]: job }))
  }, [])
  const inFlight = useRef(new Set<string>())
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const latest = useRef({ signer, reading })
  latest.current = { signer, reading }

  const run = useCallback(
    (entry: OutboxEntry) => {
      if (inFlight.current.has(entry.requestId)) return
      inFlight.current.add(entry.requestId)
      queue.current = queue.current.then(async () => {
        const { signer: s, reading: r } = latest.current
        try {
          if (!s || r?.state !== 'ready' || r.keyId === null) {
            // Not ready to sign yet: try again on the next resume.
            return
          }
          const outcome = await s.send(entry, r.keyId, {
            prepareTip: (args) =>
              prepareTip({
                ...args,
                articleId: args.articleId as Id<'articles'>,
              }).then((p) => ({ ...p, prepareId: p.prepareId as string })),
            submitTip: (args) =>
              submitTip({
                ...args,
                prepareId: args.prepareId as Id<'tips'> | Id<'highlightTips'>,
              }).then((a) => ({ ...a, receiptId: a.receiptId as string })),
            newRequestId: () => crypto.randomUUID(),
            saveSubmit: (requestId, submit) =>
              outbox.update(requestId, { submit }),
            renameRequest: (from, to) => {
              outbox.update(from, { requestId: to })
              setJobs((all) => ({
                ...all,
                [to]: all[from] ?? { status: 'sending' },
              }))
            },
          })
          if (outcome.kind === 'accepted') {
            setJob(entry.requestId, { status: 'sent' })
          } else if (outcome.kind === 'unconfirmed') {
            // The signed tip is saved; the next resume resubmits it.
          } else {
            outbox.remove(entry.requestId)
            setJob(entry.requestId, {
              status: 'failed',
              code:
                outcome.kind === 'refused'
                  ? outcome.code
                  : outcome.kind === 'stopped'
                    ? `STOPPED_${outcome.reason}`
                    : 'UNREACHABLE',
            })
          }
        } finally {
          inFlight.current.delete(entry.requestId)
        }
      })
    },
    [outbox, prepareTip, submitTip, setJob]
  )

  // Reconcile with the server: drop entries it lists as accepted; resume
  // the rest while their prepared tip can still be submitted.
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

  useEffect(() => {
    if (device !== 'ready') return
    const resume = () => {
      for (const entry of unansweredEntries(entries, session)) run(entry)
    }
    resume()
    const id = window.setInterval(resume, RESUME_EVERY_MS)
    return () => window.clearInterval(id)
  }, [device, entries, recent, run]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback<LiveState['send']>(
    (target, cents, meta, requestId) => {
      if (!session || !userId) return
      const price = session.prices[0]?.usd ?? 0
      const entry: OutboxEntry = {
        requestId,
        userId,
        articleId: target.articleId,
        passage: target.kind === 'passage' ? target.passage : null,
        amountCents: cents,
        estimate: centsToBaseUnits(cents, price).toString(),
        createdAt: Date.now(),
        meta,
      }
      outbox.put(entry)
      setJob(requestId, { status: 'sending' })
      run(entry)
    },
    [session, userId, outbox, setJob, run]
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
