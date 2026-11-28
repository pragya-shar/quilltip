'use client'

/**
 * The payments engine: loaded with `import()` by the shell in the root
 * layout (`PaymentsShell`) once the visitor is signed in or shows tip
 * intent, and kept mounted across client navigation, so the balance, the
 * device key and tips in flight persist between pages and resume after a
 * reload. It writes every view into `paymentsStore`; the hooks read them.
 *
 * Wallet-free: it reads `balance.session` (keyed by the signed-in user), the
 * reader's first page of `activity.mine` and this browser's outbox; the
 * signer (session key, local ledger, Stellar SDK) loads with a second
 * `import()` when the browser is idle and the reader has a balance. The send
 * rules (single flight, an error ends one job only, jobs bound to one
 * reader, account changes mid-send) are in `lib/payments/send-queue.ts`.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useLayoutEffect,
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
import { bindingHolds, pairOf, paymentsStore } from '@/lib/payments/store'
import {
  signOutStop,
  stopKeys,
  unconfirmedStops,
} from '@/lib/payments/signOutStop'
import { tipAmount } from '@/lib/payments/money'
import {
  onJob,
  onOnline,
  tapOnce,
  type JobStatus,
} from '@/lib/payments/tip-machine'
import type {
  BalanceView,
  Cents,
  TipController,
  TipMeta,
  TipPhase,
  TipTarget,
  UnavailableReason,
} from '@/lib/payments/types'
import type { DeviceReading, Signer } from '@/lib/payments/live/signer'
import {
  createSendQueue,
  type QueueBinding,
  type QueueContext,
  type SendQueue,
} from '@/lib/payments/send-queue'
import {
  TIP_LADDER,
  balanceViewOf,
  effectiveChoice,
  tipBlocked,
  readerItemsOf,
  pageState,
  publicChoices,
  unansweredEntries,
  type ActivityEntry,
  type DeviceState,
} from '@/lib/payments/views'
import { EarningsWatch } from './EarningsWatch'
import { useAsOf } from './useAsOf'
import { OwnTipsWatch } from './OwnTipsWatch'
import { TipContextWatch } from './TipContextWatch'
import { WriterWatch } from './WriterWatch'

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

/** One key per tipped thing, stable across remounts of its control. */
function targetKey(target: TipTarget): string {
  return target.kind === 'passage'
    ? `${target.articleId}:${target.passage.startOffset}:${target.passage.endOffset}`
    : target.articleId
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

function useStoreValue<T>(
  select: (s: ReturnType<typeof paymentsStore.get>) => T
) {
  return useSyncExternalStore(
    paymentsStore.subscribe,
    () => select(paymentsStore.get()),
    () => select(paymentsStore.get())
  )
}

export function PaymentsEngine() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const rawSession = useQuery(
    api.balance.session,
    isAuthenticated ? {} : 'skip'
  )
  const hasBalance = !!rawSession && rawSession.status !== 'none'
  // A signed-out visitor's tip button states an amount from public terms.
  const publicTerms = useQuery(
    api.balance.publicTipTerms,
    !isLoading && !isAuthenticated ? {} : 'skip'
  )
  const reader = usePaginatedQuery(
    api.activity.mine,
    isAuthenticated && hasBalance ? { role: 'reader' } : 'skip',
    { initialNumItems: READER_PAGE }
  )
  const prepareTip = useMutation(api.tabs.prepareTip)
  const submitTip = useMutation(api.tabs.submitTip)
  const stopKey = useMutation(api.tabs.prepareRevokeKey)

  const outbox = outboxStore()
  const outboxVersion = useSyncExternalStore(
    outbox.subscribe,
    outbox.version,
    () => 0
  )
  const userId = rawSession?.userId ?? null
  // The pair the server answered for. Everything this engine publishes or
  // sends is bound to it, and only while the session token names it too.
  const pair =
    rawSession?.userId && rawSession.sessionId
      ? pairOf(rawSession.userId, rawSession.sessionId)
      : null
  const owner = useStoreValue((s) => s.owner)
  const live = useStoreValue((s) => bindingHolds(s, pair))
  // Before any watcher publishes (their effects run after this layout
  // effect): the store holds this pair's figures, nobody else's. Claimed
  // whenever the store is unclaimed (another tab's sign-in cleared it) and
  // whenever the answer changes, so A, then B, then A again recovers.
  useLayoutEffect(() => {
    if (pair && owner !== pair) paymentsStore.claim(pair)
  }, [pair, owner])
  const entries = useMemo(
    () => (userId ? outbox.list(userId) : []),
    [outbox, userId, outboxVersion] // eslint-disable-line react-hooks/exhaustive-deps
  )
  // The session lists only the newest accepted ids; ask about this device's
  // own unanswered tips by id, wherever they are in the reader's history.
  const ownIds = entries.map((e) => e.requestId)
  const acceptedOwn = useQuery(
    api.balance.acceptedRequests,
    isAuthenticated && ownIds.length > 0 ? { requestIds: ownIds } : 'skip'
  )
  const acceptedKey = acceptedOwn?.join(',') ?? ''
  const session = useMemo(
    () =>
      rawSession && acceptedOwn && acceptedOwn.length > 0
        ? {
            ...rawSession,
            recentRequestIds: [...rawSession.recentRequestIds, ...acceptedOwn],
          }
        : rawSession,
    [rawSession, acceptedKey] // eslint-disable-line react-hooks/exhaustive-deps
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

  // Before a sign-out, Quilltip stops accepting tips under this browser's
  // keys for this reader (shell/signOut/pocket.ts runs it, bounded).
  useEffect(() => {
    if (!signer || !binding) return
    const userId = binding.userId
    const live = new Set(
      (session?.devices ?? []).filter((d) => !d.revoked).map((d) => d.keyId)
    )
    // A stop before an earlier sign-out that was not confirmed: try again
    // now, for the keys still live.
    const retry = unconfirmedStops(userId).filter((id) => live.has(id))
    if (retry.length > 0)
      void stopKeys(userId, retry, (keyId) => stopKey({ keyId }))
    return signOutStop.set(async () => {
      const held = await signer.heldKeyIds()
      await stopKeys(
        userId,
        held.filter((keyId) => live.has(keyId)),
        (keyId) => stopKey({ keyId })
      )
    })
  }, [signer, bindingKey, devicesKey, stopKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
  // A new reader gets a new queue; the old one stops. (Not on effect
  // cleanup: a development remount must keep the queue it made.)
  const lastQueue = useRef<SendQueue | null>(null)
  useEffect(() => {
    if (lastQueue.current && lastQueue.current !== queue)
      lastQueue.current.dispose()
    lastQueue.current = queue
    setJobState((state) =>
      state.key === bindingKey ? state : { key: bindingKey, jobs: {} }
    )
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
      if (!paymentsStore.bound(pair)) return
      for (const entry of unansweredEntries(entries, session))
        queue.enqueue(entry)
    }
    resume()
    const id = window.setInterval(resume, RESUME_EVERY_MS)
    return () => window.clearInterval(id)
  }, [device, entries, recent, queue, pair]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback<
    (target: TipTarget, cents: Cents, meta: TipMeta, requestId: string) => void
  >(
    (target, cents, meta, requestId) => {
      // Never for a pair the session token does not name now.
      if (!session || !binding || !queue || !paymentsStore.bound(pair)) return
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
    [session, binding, queue, outbox, setJob, pair]
  )

  const asOf = useAsOf(online && session !== undefined, now)
  const balance = useMemo(
    () =>
      balanceViewOf({
        authLoading: isLoading,
        signedIn: isAuthenticated,
        session,
        outbox: entries,
        device,
        deviceKind: reading?.view ?? null,
        online,
        now,
        asOf,
      }),
    [
      isLoading,
      isAuthenticated,
      session,
      entries,
      device,
      reading,
      online,
      now,
      asOf,
    ]
  )
  const publicAmounts = useMemo(() => publicChoices(publicTerms), [publicTerms])
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
      canLoadMore: pageState(reader.status).canLoadMore,
      loadingMore: pageState(reader.status).loadingMore,
      loadMore: () => reader.loadMore(READER_PAGE),
    }),
    [reader, entries, session, now, hasBalance]
  )

  // Publish the reader's views, only while the binding holds, and again
  // when it holds again (a claim clears them).
  useEffect(() => {
    if (live) paymentsStore.set({ balance, readerActivity })
  }, [balance, readerActivity, live])

  // Tip controls: one controller per registered control.
  const registrations = useStoreValue((s) => s.registrations)
  const queuedTaps = useStoreValue((s) => s.queuedTaps)
  const missedTaps = useStoreValue((s) => s.missedTaps)
  const watches = useStoreValue((s) => s.watches)
  const [tipState, setTipState] = useState<
    Record<string, { phase: TipPhase; chosen: Cents | null }>
  >({})
  const [contexts, setContexts] = useState<
    Record<string, { tippable: boolean; reason: string | null } | undefined>
  >({})
  const articleIds = useMemo(
    () => [
      ...new Set(Object.values(registrations).map((r) => r.target.articleId)),
    ],
    [registrations]
  )

  // Job reports move a control from sending to sent or failed.
  useEffect(() => {
    setTipState((all) => {
      let changed = false
      const next = { ...all }
      for (const [id, t] of Object.entries(all)) {
        if (t.phase.phase !== 'sending') continue
        const moved = onJob(t.phase, jobs[t.phase.requestId])
        if (moved !== t.phase) {
          next[id] = { ...t, phase: moved }
          changed = true
        }
      }
      return changed ? next : all
    })
  }, [jobs])

  const sendRef = useRef(send)
  sendRef.current = send
  // The phase a tap sees at once, before React renders the last tap's.
  const phases = useRef<Record<string, TipPhase>>({})
  const balanceRef = useRef(balance)
  balanceRef.current = balance
  const chosenByTarget = useRef<Record<string, Cents>>({})

  // Back online, a control that said "Offline" is ready again; nothing is
  // sent by that.
  useEffect(() => {
    if (!online) return
    for (const [id, phase] of Object.entries(phases.current))
      phases.current[id] = onOnline(phase, true)
    setTipState((all) => {
      let changed = false
      const next = { ...all }
      for (const [id, t] of Object.entries(all)) {
        const moved = onOnline(t.phase, true)
        if (moved !== t.phase) {
          next[id] = { ...t, phase: moved }
          changed = true
        }
      }
      return changed ? next : all
    })
  }, [online])

  const controllers = useMemo(() => {
    const out: Record<string, TipController> = {}
    for (const [id, reg] of Object.entries(registrations)) {
      const context = contexts[reg.target.articleId]
      const key = targetKey(reg.target)
      // A choice made before signing in carries over (never raised).
      const t = tipState[id] ?? {
        phase: { phase: 'idle' } as TipPhase,
        chosen: chosenByTarget.current[key] ?? null,
      }
      phases.current[id] = t.phase
      const signedOut = balance.status === 'signed-out'
      // Signed out: the offer from public terms only, never a balance.
      const offered = signedOut
        ? publicAmounts
        : balance.amounts.map((a) => a.cents)
      // Never above the reader's choice (views.ts, `effectiveChoice`).
      const cents = effectiveChoice(t.chosen, offered)
      const blocked = tipBlocked(cents, offered, balance.noAmountReason)
      const early =
        balance.status === 'signed-out' ||
        balance.status === 'none' ||
        balance.status === 'closing' ||
        balance.device === 'unavailable' ||
        balance.device === 'needs-setup'
      // Whether the article can take a tip at all comes first, for everyone:
      // no control is offered until it is known.
      const ready =
        context !== undefined &&
        (signedOut
          ? publicTerms !== undefined
          : early ||
            (balance.status === 'ready' && balance.device !== 'loading'))
      const unavailable = ready ? unavailableOf(balance, context) : null
      const setPhase = (phase: TipPhase) =>
        setTipState((all) => ({
          ...all,
          [id]: { phase, chosen: all[id]?.chosen ?? null },
        }))
      const tip = async () => {
        // The engine's own check, whoever holds this controller.
        if (!paymentsStore.bound(pair)) return
        paymentsStore.clearMissed(id)
        if (!ready || unavailable) return
        const current = phases.current[id] ?? { phase: 'idle' as const }
        const b = balanceRef.current
        if (cents === null) {
          // No amount fits: nothing is sent; a low balance offers to add money.
          if (blocked === 'balance' && current.phase !== 'sending') {
            const next: TipPhase = {
              phase: 'needs-funds',
              amount: tipAmount(TIP_LADDER[0]),
              available: b.available,
            }
            phases.current[id] = next
            setPhase(next)
          }
          return
        }
        const requestId = crypto.randomUUID()
        // Decided and recorded synchronously: a second tap is ignored.
        const decision = tapOnce(
          phases.current,
          id,
          cents,
          { online: b.online, available: b.available, unavailable },
          requestId
        )
        setPhase(decision.phase)
        if (decision.send)
          sendRef.current(reg.target, cents, reg.meta, requestId)
      }
      out[id] = {
        state: t.phase,
        amount: cents === null || signedOut ? null : tipAmount(cents),
        blocked: signedOut ? null : blocked,
        amounts: signedOut ? [] : balance.amounts,
        signedOut:
          signedOut && cents !== null && unavailable === 'signed-out'
            ? {
                signedOut: true,
                amount: tipAmount(cents),
                amounts: offered.map(tipAmount),
              }
            : null,
        setAmount: (next) => {
          chosenByTarget.current[key] = next
          setTipState((all) => {
            const prev = all[id]?.phase ?? { phase: 'idle' as const }
            return {
              ...all,
              [id]: {
                chosen: next,
                phase: prev.phase === 'sending' ? prev : { phase: 'idle' },
              },
            }
          })
        },
        tip,
        reset: () =>
          setTipState((all) => {
            const prev = all[id]
            if (!prev || prev.phase.phase === 'sending') return all
            return { ...all, [id]: { ...prev, phase: { phase: 'idle' } } }
          }),
        ready,
        warming: !ready && balance.status !== 'signed-out',
        queued: id in queuedTaps,
        missed: id in missedTaps,
        unavailable,
      }
    }
    return out
  }, [
    registrations,
    contexts,
    tipState,
    balance,
    queuedTaps,
    missedTaps,
    publicAmounts,
    pair,
    publicTerms,
  ])

  useEffect(() => {
    // Controllers are published only while the binding holds.
    if (!live) return
    paymentsStore.set({ tips: controllers })
    // A tap made before the engine was ready: send it once, for what was
    // pressed (its own target, request id and amount, never raised), not
    // for whatever the control shows now.
    for (const [id, controller] of Object.entries(controllers)) {
      if (!(id in queuedTaps)) continue
      if (!controller.ready) continue
      const tap = paymentsStore.takeTap(id, pair)
      if (!tap || controller.unavailable) continue
      const cents = effectiveChoice(
        tap.cents,
        controller.amounts.map((a) => a.cents)
      )
      if (cents === null) continue
      const b = balanceRef.current
      const decision = tapOnce(
        phases.current,
        id,
        cents,
        { online: b.online, available: b.available, unavailable: null },
        tap.requestId
      )
      setTipState((all) => ({
        ...all,
        [id]: { phase: decision.phase, chosen: all[id]?.chosen ?? null },
      }))
      if (decision.send)
        sendRef.current(tap.target, cents, tap.meta, tap.requestId)
    }
  }, [controllers, live]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {articleIds.map((articleId) => (
        <TipContextWatch
          key={articleId}
          articleId={articleId as Id<'articles'>}
          // Public facts about the article (registered, split, the
          // caller's own): asked for signed in or out, once auth is known.
          enabled={!isLoading}
          onValue={(value) =>
            setContexts((all) =>
              all[articleId] === value ? all : { ...all, [articleId]: value }
            )
          }
        />
      ))}
      {articleIds.map((articleId) => (
        <OwnTipsWatch
          key={`own:${articleId}`}
          articleId={articleId as Id<'articles'>}
          enabled={isAuthenticated && !isLoading}
          live={live}
        />
      ))}
      {watches.writer > 0 ? <WriterWatch now={now} live={live} /> : null}
      {watches.earnings > 0 ? (
        <EarningsWatch now={now} online={online} live={live} />
      ) : null}
    </>
  )
}

function unavailableOf(
  balance: BalanceView,
  context: { tippable: boolean; reason: string | null } | undefined
): UnavailableReason | null {
  // The article first: one that cannot take a tip (not registered on
  // chain, split, or the reader's own) says so before anything about the
  // reader, so no tip is offered that the server would refuse.
  if (context && !context.tippable)
    return context.reason === 'own-article' ? 'own-article' : 'not-tippable'
  if (balance.status === 'signed-out') return 'signed-out'
  if (balance.status === 'none') return 'no-balance'
  if (balance.status === 'closing') return 'closing'
  if (!balance.settlement.enabled) return 'settlement-off'
  if (balance.device === 'checking') return 'device-checking'
  if (!balance.deviceReady) return 'device'
  return null
}
