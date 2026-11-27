/**
 * The money views the Pocket reads.
 *
 * A mirror of the part of `lib/payments/types.ts` (pull request 561, at
 * db4b0431) that the Pocket renders, with the same names and shapes, so the
 * screen is built against the money layer's interface before that pull
 * request merges. When it merges, this file becomes a re-export of
 * `@/lib/payments/types` and the fields marked "Asked of 561" either arrive
 * there or leave here.
 *
 * Every amount is a `Money` the money layer wrote: the Pocket never formats,
 * rounds, adds or subtracts money (system/README.md, "Money").
 */

/** Integer US cents (running figures may carry 1/10,000 of a cent). */
export type Cents = number

/** An amount in dollars and its display text ("$4.20", "≈ $2.54"). */
export type Money = { cents: Cents; display: string }

export type NotPaidReason = 'shortfall' | 'expired' | 'rejected' | 'reset'

export type BalanceView = {
  status:
    | 'loading'
    | 'signed-out'
    | 'none'
    | 'ready'
    | 'closing'
    | 'unavailable'
  /** What a tip can use now. Null until the server answered. */
  available: Money | null
  /** Accepted tips not yet paid on chain, at their own dollars. */
  pending: Money | null
  device: 'loading' | 'ready' | 'needs-setup' | 'unavailable'
  settlement: { enabled: boolean; expectedWithinMs: number }
  online: boolean
  network: 'testnet'
  /** Asked of 561: the exact token amount behind `available`, as display
   * text ("2,000.1234567 XLM"). */
  exact?: { token: 'XLM'; available: string } | null
  /** Asked of 561: money added and not yet in `available` (exact). */
  arriving?: Money | null
  /** Asked of 561: server time of the figures, for an offline screen. */
  asOf?: number | null
}

export type ActivityItem = {
  id: string
  requestId: string | null
  role: 'reader' | 'writer'
  counterparty: { name: string; username: string | null }
  article: { title: string; href: string | null }
  passage: string | null
  /** The tip as the reader sent it, exact. Rows show this. */
  amount: Money
  /** The writer's share. */
  net: Money
  /** What has been paid on chain for this tip, and the writer's share. */
  paid: Money
  paidNet: Money
  status: 'sending' | 'sent' | 'on-chain' | 'not-paid'
  reason: NotPaidReason | null
  at: number
  lagging: boolean
  txHash: string | null
  /** Asked of 561: exact display text for the receipt, written by the
   * money layer ("9.75¢"), so the Pocket never computes a fee or a rest. */
  detail?: {
    /** The writer's exact share of the tip. */
    net: string
    /** Quilltip's 2.5%, exact. */
    fee: string
    /** For a tip paid in part: what arrived and what did not, in the
     * tip's own terms for this side (reader: of the tip; writer: of the
     * share). Null when the tip is not paid in part. */
    paid: string | null
    unpaid: string | null
    /** The exact token amounts ("0.0785398 XLM"). */
    tokenGross: string | null
  } | null
}

export type ActivityView = {
  status: 'loading' | 'ready' | 'unavailable'
  items: ActivityItem[]
  canLoadMore: boolean
  loadMore(): void
  /** Asked of 561: a next page is on its way. */
  loadingMore?: boolean
}

/** Figures exist only when `status` is `ready`; otherwise they are null. */
export type EarningsView = {
  status: 'loading' | 'signed-out' | 'ready' | 'unavailable'
  pending: Money | null
  /** Paid on chain and collectable now. */
  available: Money | null
  /** Already in the writer's wallet. */
  collected: Money | null
  total: Money | null
  onHold: Money | null
  notPaid: Money | null
  counts: {
    pending: number
    onHold: number
    notPaid: number
    settled: number
  } | null
  lagging: boolean
  exact: { token: 'XLM'; available: string; collected: string } | null
  /** Asked of 561: whether this person writes (has published or has been
   * tipped). Until it exists the Pocket decides from the counts. */
  isWriter?: boolean
  asOf?: number | null
}
