/**
 * View models for the balance, tip, activity and earnings screens (payments
 * v3 slice 1; `docs/architecture/v3/interfaces.md`, I1). Plain data: the UI
 * reads these from the hooks in `hooks/payments/` and never imports Convex,
 * the wallet kit or `lib/stellar` directly. Type-only imports, so this file
 * adds nothing to a bundle.
 */
import type { Id } from '@/convex/_generated/dataModel'

/** Integer US cents (running figures may carry 1/10,000 of a cent). */
export type Cents = number

/** An amount in dollars and its display text ("$4.20"). */
export type Money = { cents: Cents; display: string }

export type PassageRef = {
  text: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
}

export type TipTarget =
  | { kind: 'article'; articleId: Id<'articles'> }
  | { kind: 'passage'; articleId: Id<'articles'>; passage: PassageRef }

/** Settlement of one tip, in the slice (no direct payout yet). */
export type SettlementState = 'accepted' | 'on-chain' | 'not-paid'

/**
 * Why a tip was not paid. `shortfall`: the reader's balance was short when
 * it was paid out; it goes through if the reader adds money. The others are
 * final: the reader keeps the money.
 */
export type NotPaidReason = 'shortfall' | 'expired' | 'rejected' | 'reset'

/** Why this reader cannot tip from the balance here and now. */
export type UnavailableReason =
  | 'signed-out'
  | 'no-balance'
  | 'closing'
  | 'device'
  | 'own-article'
  | 'not-tippable'
  | 'settlement-off'

export type TipPhase =
  | { phase: 'idle' }
  /** The server has not answered yet. Nothing is final. */
  | { phase: 'sending'; requestId: string; amount: Money }
  /** The server accepted the tip. It is final: there is no Undo. */
  | { phase: 'sent'; requestId: string; amount: Money }
  /** Nothing was charged. */
  | { phase: 'failed'; code: string; amount: Money }
  /** Checked before sending: nothing was sent. */
  | { phase: 'offline'; amount: Money }
  | { phase: 'needs-funds'; amount: Money; available: Money }

export type BalanceView = {
  status: 'loading' | 'signed-out' | 'none' | 'ready' | 'closing'
  /** What a tip can use now, including tips sent from this device. */
  available: Money
  /** Accepted tips not yet paid on chain, at their own dollars. */
  pending: Money
  /** This device holds a key that can tip without a prompt. */
  deviceReady: boolean
  device: 'loading' | 'ready' | 'needs-setup' | 'unavailable'
  limits: {
    perTip: Money
    dailyLeft: Money
    minTip: Money
    defaultTip: Money
  } | null
  /** The quick amounts beside the tip button, within every limit. */
  amounts: Money[]
  /** Tips accepted but slower than the expected settlement time are lagging. */
  settlement: { enabled: boolean; expectedWithinMs: number }
  online: boolean
  network: 'testnet'
}

export type ActivityItem = {
  id: string
  requestId: string | null
  role: 'reader' | 'writer'
  counterparty: { name: string; username: string | null }
  article: { title: string; href: string | null }
  passage: string | null
  /** The tip as chosen, in dollars at tip time. */
  amount: Money
  /** The writer's share. */
  net: Money
  status: 'sending' | 'sent' | 'on-chain' | 'not-paid'
  reason: NotPaidReason | null
  at: number
  /** Accepted, not on chain, and older than settlement normally takes. */
  lagging: boolean
  txHash: string | null
  /** The exact token amounts, for the detail view. */
  exact: { token: 'XLM'; gross: string; net: string } | null
}

export type ActivityView = {
  status: 'loading' | 'ready'
  items: ActivityItem[]
  canLoadMore: boolean
  loadMore(): void
}

export type EarningsView = {
  status: 'loading' | 'signed-out' | 'ready'
  pending: Money
  /** Paid on chain and collectable now. */
  available: Money
  /** Already in the writer's wallet. */
  collected: Money
  total: Money
  onHold: Money
  notPaid: Money
  counts: { pending: number; onHold: number; notPaid: number; settled: number }
  /** Some pending tips are older than settlement normally takes. */
  lagging: boolean
  exact: { token: 'XLM'; available: string; collected: string } | null
}

export type TipController = {
  state: TipPhase
  /** The amount the tip button states. */
  amount: Money
  amounts: Money[]
  setAmount(cents: Cents): void
  /** Sends the chosen amount from the balance. Ignored while sending. */
  tip(): Promise<void>
  reset(): void
  /** False while the balance, the device or the article check is loading. */
  ready: boolean
  /** Null when this reader can tip here from the balance. */
  unavailable: UnavailableReason | null
}

/** What each screen reads. The live provider and the fixture supply it. */
export type PaymentsRuntime = {
  useBalance(): BalanceView
  useTip(target: TipTarget, meta: TipMeta): TipController
  useActivity(role: 'reader' | 'writer'): ActivityView
  useEarnings(): EarningsView
}

/** Shown on the optimistic activity row until the server answers. */
export type TipMeta = {
  articleTitle: string
  writerName: string
  href: string | null
}
