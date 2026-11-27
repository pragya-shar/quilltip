'use client'

/**
 * The live `PaymentsRuntime`: hooks that read the state the root provider
 * keeps (`components/payments/PaymentsProvider.tsx`) and the reactive Convex
 * queries. Everything here is small and wallet-free; the signer loads later.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { money } from '../money'
import { onJob, onTap, type JobStatus } from '../tip-machine'
import type {
  ActivityView,
  BalanceView,
  Cents,
  EarningsView,
  PaymentsRuntime,
  TipController,
  TipMeta,
  TipPhase,
  TipTarget,
  UnavailableReason,
} from '../types'
import { activityItemOf, earningsViewOf, type ActivityEntry } from '../views'

export type LiveState = {
  balance: BalanceView
  readerActivity: ActivityView
  jobs: Record<string, JobStatus>
  /** Writes the outbox entry at once, then sends it in the background. */
  send(target: TipTarget, cents: Cents, meta: TipMeta, requestId: string): void
  /** A clock that ticks, for the lag notices. */
  now: number
}

export const LiveStateContext = createContext<LiveState | null>(null)

function useLiveState(): LiveState {
  const state = useContext(LiveStateContext)
  if (!state) throw new Error('The payments provider is not mounted.')
  return state
}

function useLiveBalance(): BalanceView {
  return useLiveState().balance
}

const WRITER_PAGE = 20

function useLiveActivity(role: 'reader' | 'writer'): ActivityView {
  const live = useLiveState()
  const { isAuthenticated } = useConvexAuth()
  const writer = usePaginatedQuery(
    api.activity.mine,
    role === 'writer' && isAuthenticated ? { role: 'writer' } : 'skip',
    { initialNumItems: WRITER_PAGE }
  )
  const items = useMemo(
    () =>
      (writer.results as ActivityEntry[]).map((e) =>
        activityItemOf(e, live.now)
      ),
    [writer.results, live.now]
  )
  if (role === 'reader') return live.readerActivity
  return {
    status: writer.status === 'LoadingFirstPage' ? 'loading' : 'ready',
    items,
    canLoadMore: writer.status === 'CanLoadMore',
    loadMore: () => writer.loadMore(WRITER_PAGE),
  }
}

function useLiveEarnings(): EarningsView {
  const live = useLiveState()
  const { isAuthenticated, isLoading } = useConvexAuth()
  const earnings = useQuery(api.earnings.mine, isAuthenticated ? {} : 'skip')
  const newest = usePaginatedQuery(
    api.activity.mine,
    isAuthenticated ? { role: 'writer' } : 'skip',
    { initialNumItems: WRITER_PAGE }
  )
  return earningsViewOf({
    signedIn: isLoading || isAuthenticated,
    earnings: isLoading ? undefined : earnings,
    entries: newest.results as ActivityEntry[],
    now: live.now,
  })
}

function unavailableOf(
  balance: BalanceView,
  context: { tippable: boolean; reason: string | null } | undefined
): UnavailableReason | null {
  if (balance.status === 'signed-out') return 'signed-out'
  if (balance.status === 'none') return 'no-balance'
  if (balance.status === 'closing') return 'closing'
  if (!balance.settlement.enabled) return 'settlement-off'
  if (!balance.deviceReady) return 'device'
  if (context && !context.tippable)
    return context.reason === 'own-article' ? 'own-article' : 'not-tippable'
  return null
}

function useLiveTip(target: TipTarget, meta: TipMeta): TipController {
  const live = useLiveState()
  const { balance } = live
  const context = useQuery(
    api.balance.tipContext,
    target.articleId && balance.status === 'ready'
      ? { articleId: target.articleId }
      : 'skip'
  )
  const defaultCents = balance.limits?.defaultTip.cents ?? 100
  const [chosen, setCents] = useState<Cents>(defaultCents)
  // The chosen amount, or the largest one every limit allows.
  const cents =
    balance.amounts.length === 0 ||
    balance.amounts.some((a) => a.cents === chosen)
      ? chosen
      : balance.amounts[balance.amounts.length - 1]!.cents
  const [phase, setPhase] = useState<TipPhase>({ phase: 'idle' })
  const job = phase.phase === 'sending' ? live.jobs[phase.requestId] : undefined
  useEffect(() => {
    const next = onJob(phase, job)
    if (next !== phase) setPhase(next)
  }, [phase, job])

  // Signed out or without a balance, the answer is known at once; otherwise
  // wait for the device check and the article check.
  const early =
    balance.status === 'signed-out' ||
    balance.status === 'none' ||
    balance.status === 'closing' ||
    balance.device === 'unavailable' ||
    balance.device === 'needs-setup'
  const ready =
    early ||
    (balance.status === 'ready' &&
      balance.device !== 'loading' &&
      context !== undefined)
  const unavailable = ready ? unavailableOf(balance, context) : null

  const tip = useCallback(async () => {
    if (!ready || unavailable) return
    const requestId = crypto.randomUUID()
    const decision = onTap(
      phase,
      cents,
      {
        online: balance.online,
        available: balance.available,
        unavailable,
      },
      requestId
    )
    setPhase(decision.phase)
    if (decision.send) live.send(target, cents, meta, requestId)
  }, [ready, unavailable, phase, cents, balance, live, target, meta])

  return {
    state: phase,
    amount: money(cents),
    amounts: balance.amounts,
    setAmount: (next) => {
      setCents(next)
      if (phase.phase !== 'sending') setPhase({ phase: 'idle' })
    },
    tip,
    reset: () => {
      if (phase.phase !== 'sending') setPhase({ phase: 'idle' })
    },
    ready,
    unavailable,
  }
}

export const liveRuntime: PaymentsRuntime = {
  useBalance: useLiveBalance,
  useTip: useLiveTip,
  useActivity: useLiveActivity,
  useEarnings: useLiveEarnings,
}
