/**
 * View models for the balance, tip, activity and earnings screens. Plain
 * data: the UI
 * reads these from the hooks in `hooks/payments/` and never imports Convex,
 * the wallet kit or `lib/stellar` directly. Type-only imports, so this file
 * adds nothing to a bundle.
 */
import type { Id } from '@/convex/_generated/dataModel'

/** Integer US cents (running figures may carry 1/10,000 of a cent). */
export type Cents = number

/**
 * An amount in dollars and its display text ("$4.20", exact; `formatMoney`).
 * `converted`: converted from a token amount at today's price (the reader's
 * spendable); false or absent for a figure stored at tip time. Its display
 * follows `CONVERTED_STYLE` in `money.ts`; write it yourself with
 * `formatMoney(cents, { converted, convertedStyle })` to choose otherwise.
 */
export type Money = {
  cents: Cents
  display: string
  converted?: boolean
  /** For a screen reader: "about 18 dollars 40" (`spokenMoney`). */
  spoken?: string
  /** On a tip amount (the amounts offered and the one chosen): the short
   * text for a control, "$1", "$0.50" (`tipAmount`). Rows and receipts use
   * `display`. */
  short?: string
}

export type PassageRef = {
  text: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
}

/** From a string id: `tipTargetOf` in `target.ts`, which checks it. */
export type TipTarget =
  | { kind: 'article'; articleId: Id<'articles'> }
  | { kind: 'passage'; articleId: Id<'articles'>; passage: PassageRef }

/** Settlement of one balance tip (no direct payout yet). */
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
  /** The payments code could not load. Reading is unaffected. */
  | 'not-loaded'
  /** No payments shell on this page: other tip paths stay as they are. */
  | 'absent'

/**
 * A tip's phases. A short `holding` phase before sending (a few seconds in
 * which the tip can still be cancelled) is planned between `idle` and
 * `sending`, owned by this controller; it is not built yet, so surfaces
 * should switch on `phase` with a default branch.
 */
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
  | { phase: 'needs-funds'; amount: Money; available: Money | null }

export type BalanceView = {
  /** `unavailable`: payments could not load or answer; reading is unaffected. */
  status:
    | 'loading'
    | 'signed-out'
    | 'none'
    | 'ready'
    | 'closing'
    | 'unavailable'
  /** What a tip can use now, including tips sent from this device.
   * Null until the server answered: never a placeholder zero. Also null in
   * `ready` or `closing` when no price is known (`price` null,
   * `noAmountReason: 'price'`): the dollar value is not known, and `exact`
   * holds the token amount. */
  available: Money | null
  /** Accepted tips not yet paid on chain, at their own dollars. */
  pending: Money | null
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
  /** Why no amount fits now, when none does. `price`: no price is known to
   * convert the balance with, so no amount is known to fit. */
  noAmountReason: 'cap' | 'daily' | 'balance' | 'price' | null
  /** Tips accepted but slower than the expected settlement time are lagging. */
  settlement: { enabled: boolean; expectedWithinMs: number }
  online: boolean
  network: 'testnet'
  /** The exact token amount of `available`. Null until read. */
  exact?: { token: 'XLM'; available: string } | null
  /**
   * The price the converted `available` used: one token's dollar price,
   * exact to four decimals ("$0.1273"), and when it was read. Null when the
   * balance is not converted or no price is known.
   */
  price?: { perToken: Money; asOf: number } | null
  /**
   * When these figures were last known current (client time): it advances
   * while online and stops when offline, so a screen can say how old they
   * are. Null until read.
   */
  asOf?: number | null
}

export type ActivityItem = {
  id: string
  requestId: string | null
  role: 'reader' | 'writer'
  counterparty: { name: string; username: string | null }
  /** `id`: the article's id, so a screen can find this reader's tips on
   * it; null where the server gave none. */
  article: { id: string | null; title: string; href: string | null }
  passage: string | null
  /** The tip as chosen, in dollars at tip time. */
  amount: Money
  /** The writer's share; null while sending (unknown until accepted). */
  net: Money | null
  /** What has been paid on chain for this tip (all once paid, part of a
   * tip paid short), and the writer's share of it. */
  paid: Money
  paidNet: Money
  /** The platform's 2.5% of this tip (`amount - net`), exact; null while
   * sending. */
  fee: Money | null
  /** What of the tip is not paid on chain (`amount - paid`), and the
   * writer's share of it (`net - paidNet`). Zero once paid in full. */
  unpaid: Money
  unpaidNet: Money | null
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
  status: 'loading' | 'ready' | 'unavailable'
  items: ActivityItem[]
  canLoadMore: boolean
  /** A further page is loading (the first load is `status: 'loading'`). */
  loadingMore?: boolean
  loadMore(): void
}

/**
 * Figures exist only when `status` is `ready`; otherwise they are `null`.
 * `none`: signed in, never published and never received a tip, so there
 * are no earnings to show (not earnings of zero).
 */
export type EarningsView = {
  status: 'loading' | 'signed-out' | 'none' | 'ready' | 'unavailable'
  /** Has published or received a tip: true (`ready`), false (`none`), null
   * while not known (loading, signed out, unavailable). */
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
  /** Some pending tips are older than settlement normally takes. */
  lagging: boolean
  /**
   * When the oldest tip still on its way was accepted (server time), so a
   * screen can apply the lag rule itself; null when nothing is pending or
   * not read yet.
   */
  oldestPendingAt?: number | null
  exact: { token: 'XLM'; available: string; collected: string } | null
  /** As `BalanceView.asOf`. */
  asOf?: number | null
}

export type TipController = {
  state: TipPhase
  /** The amount the tip button states and sends; null when none fits. */
  amount: Money | null
  /** Why the control cannot send now, with no figure in token units. */
  blocked: 'cap' | 'daily' | 'balance' | 'price' | 'choose' | null
  amounts: Money[]
  setAmount(cents: Cents): void
  /** Sends the chosen amount from the balance. Ignored while sending. */
  tip(): Promise<void>
  reset(): void
  /** False while the balance, the device or the article check is loading. */
  ready: boolean
  /** Signed in and the payments code is still loading: show the control. */
  warming: boolean
  /** A tap waits for the payments code; it is sent once, when ready. */
  queued: boolean
  /** Null when this reader can tip here from the balance. */
  unavailable: UnavailableReason | null
  /**
   * A signed-out visitor's offer, from public data only (the minimum tip,
   * the per-tip cap and the current price): `amount` is the default and
   * `amounts` the ladder, so the button can state an amount and open
   * sign-in. Always present: null when signed in, where the person's own amounts are
   * then `amount` and `amounts`, which stay null and empty while signed out.
   * A choice made here (`setAmount`) carries into the signed-in amounts and
   * is never raised.
   */
  signedOut: { signedOut: true; amount: Money; amounts: Money[] } | null
}

/** What each screen reads. The live provider and the fixture supply it. */
/** One of the signed-in reader's own tips on an article (accepted or
 * settled), with the tipped passage's stored text and offsets. */
export type OwnTip = {
  requestId: string | null
  passage: PassageRef | null
  amount: Money
  state: 'accepted' | 'on-chain'
  at: number
}

/** The signed-in reader's own tips on one article, newest first, at most a
 * bounded number (`complete` is false when there are more). Only while a
 * tip control for that article is on the page. */
export type OwnTipsView = {
  status: 'loading' | 'signed-out' | 'ready' | 'unavailable'
  tips: OwnTip[]
  complete: boolean
}

export type PaymentsRuntime = {
  useBalance(): BalanceView
  useTip(target: TipTarget, meta: TipMeta): TipController
  useActivity(role: 'reader' | 'writer'): ActivityView
  useEarnings(): EarningsView
  /** This reader's own tips on an article with a tip control on the page. */
  useOwnTips(articleId: string): OwnTipsView
}

/** Shown on the optimistic activity row until the server answers. */
export type TipMeta = {
  articleTitle: string
  writerName: string
  href: string | null
}
