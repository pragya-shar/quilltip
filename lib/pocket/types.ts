/**
 * The money views the Pocket reads.
 *
 * A mirror of the part of `lib/payments/types.ts` (pull request 561, at
 * a7f1ad6c) that the Pocket renders, with the same names and shapes, so the
 * screen is built against the money layer's interface before that pull
 * request merges. When it merges, this file becomes a re-export of
 * `@/lib/payments/types`.
 *
 * Every amount is a `Money` the money layer wrote: the Pocket never formats,
 * rounds, adds or subtracts money (system/README.md, "Money"). Exact
 * fractions and token amounts are written by the money layer's own
 * formatters, reached through the Pocket's source (`format`).
 */

/** Integer US cents (running figures may carry 1/10,000 of a cent). */
export type Cents = number

/** An amount in dollars and its display text ("$4.20", "$0.0975").
 * `converted`: converted from a token amount at today's price (the reader's
 * spendable); false or absent for a figure stored at tip time. */
export type Money = {
  cents: Cents
  display: string
  converted?: boolean
  /** For a screen reader, without a direction ("9.75 cents"). */
  spoken?: string
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
  /** What a tip can use now. Null until the server answered, and also null
   * in `ready` or `closing` when no price is known (`price` null,
   * `noAmountReason: 'price'`): then `exact` holds the token amount. */
  available: Money | null
  /** Accepted tips not yet paid on chain, at their own dollars. They are
   * already out of `available`. */
  pending: Money | null
  deviceReady: boolean
  device: 'loading' | 'ready' | 'needs-setup' | 'unavailable'
  /** The quick amounts beside the tip button, within every limit. */
  amounts: Money[]
  /** Why no amount fits now; `price`: no price is known. */
  noAmountReason: 'cap' | 'daily' | 'balance' | 'price' | null
  settlement: { enabled: boolean; expectedWithinMs: number }
  online: boolean
  network: 'testnet'
  /** The exact token amount of `available`. Null until read. */
  exact?: { token: 'XLM'; available: string } | null
  /** The price the converted figure used, dollars per token, and when it
   * was read; null when not converted or no price is known. */
  price?: { perToken: Money; asOf: number } | null
  /** When the figures were last known current (for stale figures). */
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
  /** The writer's share; null while sending (unknown until accepted). */
  net: Money | null
  /** What has been paid on chain for this tip, and the writer's share. */
  paid: Money
  paidNet: Money
  /** Quilltip's 2.5% of the tip, exact; null while sending. */
  fee: Money | null
  /** What of the tip is not paid on chain, and the writer's share of it
   * (null while sending). Zero once paid in full. */
  unpaid: Money
  unpaidNet: Money | null
  status: 'sending' | 'sent' | 'on-chain' | 'not-paid'
  reason: NotPaidReason | null
  at: number
  lagging: boolean
  txHash: string | null
  /** The exact token amounts, for the receipt. */
  exact: { token: 'XLM'; gross: string; net: string } | null
}

export type ActivityView = {
  status: 'loading' | 'ready' | 'unavailable'
  items: ActivityItem[]
  canLoadMore: boolean
  /** A further page is loading (the first load is `status: 'loading'`). */
  loadingMore?: boolean
  loadMore(): void
}

/** Figures exist only when `status` is `ready`; otherwise they are null.
 * `none`: signed in, never published and never received a tip. */
export type EarningsView = {
  status: 'loading' | 'signed-out' | 'none' | 'ready' | 'unavailable'
  /** Has published or received a tip: true, false, or null while not known
   * (loading, signed out, unavailable). */
  isWriter?: boolean | null
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
  asOf?: number | null
}
