/**
 * The money views the Pocket reads.
 *
 * A mirror of the part of `lib/payments/types.ts` (pull request 561, at
 * db4b0431) that the Pocket renders, with the same names and shapes, so the
 * screen is built against the money layer's interface before that pull
 * request merges. When it merges, this file becomes a re-export of
 * `@/lib/payments/types`. Fields marked "Accepted for 561" were agreed with
 * its author and land there before it merges; their exact shapes are
 * confirmed then.
 *
 * Every amount is a `Money` the money layer wrote: the Pocket never formats,
 * rounds, adds or subtracts money (system/README.md, "Money"). Exact
 * fractions and token amounts are written by the money layer's own
 * formatters, reached through the Pocket's source (`format`).
 */

/** Integer US cents (running figures may carry 1/10,000 of a cent). */
export type Cents = number

/** An amount in dollars and its display text ("$4.20", "≈ $2.54"). */
export type Money = {
  cents: Cents
  display: string
  /** Accepted for 561 (D24): a dollar figure converted from the token at
   * today's price (the reader's Ready to tip while the balance is held in
   * XLM). It is written with "≈" and two decimals. Figures stored at tip
   * time are exact and never converted. */
  converted?: boolean
}

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
  /** Accepted tips not yet paid on chain, at their own dollars. They are
   * already out of `available`. */
  pending: Money | null
  device: 'loading' | 'ready' | 'needs-setup' | 'unavailable'
  settlement: { enabled: boolean; expectedWithinMs: number }
  online: boolean
  network: 'testnet'
  /** Accepted for 561: the token amount behind `available`, in base units. */
  exact?: { token: 'XLM'; available: string } | null
  /** Accepted for 561: when the server last answered (for stale figures). */
  asOf?: number | null
  /** Asked of 561 (interface ask 10): the price the converted figure used,
   * dollars per token; null when not converted or unknown. */
  price?: { perToken: Money; asOf: number } | null
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
  /** The writer's share, exact (1/10,000 cent). */
  net: Money
  /** What has been paid on chain for this tip, and the writer's share. */
  paid: Money
  paidNet: Money
  status: 'sending' | 'sent' | 'on-chain' | 'not-paid'
  reason: NotPaidReason | null
  at: number
  lagging: boolean
  txHash: string | null
  /** The exact token amounts, for the receipt. */
  exact: { token: 'XLM'; gross: string; net: string } | null
  /** Accepted for 561: Quilltip's 2.5% of the tip, exact. */
  fee?: Money
  /** Accepted for 561: the part of the tip not paid, and the writer's share
   * of it (zero unless the tip is not paid in full). */
  unpaid?: Money
  unpaidNet?: Money
}

export type ActivityView = {
  status: 'loading' | 'ready' | 'unavailable'
  items: ActivityItem[]
  canLoadMore: boolean
  loadMore(): void
  /** Accepted for 561: a next page is on its way. */
  loadingMore?: boolean
}

/** Figures exist only when `status` is `ready`; otherwise they are null. */
export type EarningsView = {
  /** `none`, accepted for 561: this person does not write (no article and
   * nothing received). */
  status: 'loading' | 'signed-out' | 'none' | 'ready' | 'unavailable'
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
  /** Accepted for 561 (one of this or status `none`): whether this person
   * writes. */
  isWriter?: boolean
  asOf?: number | null
}
