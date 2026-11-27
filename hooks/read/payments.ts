'use client'

/**
 * The money layer as the reading view uses it: `useTip` and `useBalance`
 * with the interface of `hooks/payments` (pull request 561,
 * `lib/payments/types.ts`). Until 561 is on this branch, these are the same
 * shapes behind a context of their own: no payments runtime is mounted, so
 * the default answers `absent` and the tip bar says tipping is not
 * available; the fixture suite provides a fake runtime.
 *
 * When 561 merges, this file becomes re-exports of `useTip` and
 * `useBalance` from `@/hooks/payments/*` and of the types from
 * `@/lib/payments/types`, and the fixture provides `PaymentsRuntimeContext`.
 * Nothing here formats, rounds or adds money.
 */
import { createContext, useContext } from 'react'
import type { Id } from '@/convex/_generated/dataModel'
import type { TipHold } from '@/system/components/TipControl'

export type Cents = number
export type Money = {
  cents: Cents
  display: string
  /** Converted at today's price: the figure writes "≈" from this alone. */
  converted?: boolean
  /** The amount as a screen reader says it, when the layer gives one. */
  spoken?: string
}

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

export type TipMeta = {
  articleTitle: string
  writerName: string
  href: string | null
}

export type UnavailableReason =
  | 'signed-out'
  | 'no-balance'
  | 'closing'
  | 'device'
  | 'own-article'
  | 'not-tippable'
  | 'settlement-off'
  | 'not-loaded'
  | 'absent'

export type TipPhase =
  | { phase: 'idle' }
  /** The short hold before sending, when the controller has one: nothing
   * is sent yet, and Cancel or Escape ends it with nothing sent. */
  | { phase: 'holding'; amount: Money }
  | { phase: 'sending'; requestId: string; amount: Money }
  | { phase: 'sent'; requestId: string; amount: Money }
  | { phase: 'failed'; code: string; amount: Money }
  | { phase: 'offline'; amount: Money }
  | { phase: 'needs-funds'; amount: Money; available: Money | null }

export type TipController = {
  state: TipPhase
  amount: Money | null
  blocked: 'cap' | 'daily' | 'balance' | 'choose' | null
  amounts: Money[]
  setAmount(cents: Cents): void
  tip(): Promise<void>
  reset(): void
  ready: boolean
  warming: boolean
  queued: boolean
  unavailable: UnavailableReason | null
  /** The hold's controls while `state` is holding (the controller owns its
   * timing and sending; the view passes them to the tip control). */
  hold?: TipHold | null
  /**
   * For a signed-out visitor: the default and the offered amounts, from
   * public data only (minimum, cap, price), so the button says "Tip Tomás
   * $1" before sign-in. Null when signed in. Asked of the money layer (pull
   * request 561); the name may change when it lands.
   */
  signedOut?: SignedOutOffer | null
}

export type SignedOutOffer = {
  signedOut: true
  amount: Money
  amounts: Money[]
}

/** The part of `BalanceView` the reading view reads. */
export type BalanceView = {
  status:
    | 'loading'
    | 'signed-out'
    | 'none'
    | 'ready'
    | 'closing'
    | 'unavailable'
  available: Money | null
  online: boolean
}

export type ReadPaymentsRuntime = {
  useBalance(): BalanceView
  useTip(target: TipTarget, meta: TipMeta): TipController
}

/*
 * STAND-IN until pull request 561 provides the signed-out offer: the whole
 * block below goes, replaced by the money layer's figures. It follows the
 * money layer's ladder rule (`TIP_LADDER`, `tipChoices`, `defaultChoice` in
 * lib/payments/views.ts) so the stand-in never offers what the backend
 * could not send. The reading view itself never formats or computes money.
 */
const STAND_IN_LADDER = [10, 25, 50, 100, 200, 300, 500] as const
const STAND_IN_CHOICES = 4
const STAND_IN_DEFAULT = 100

/** "$1" for whole dollars (button labels), else "$0.25". */
const standInMoney = (cents: Cents): Money => ({
  cents,
  display:
    cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`,
})

/**
 * The offer a signed-out visitor sees from public bounds only: the ladder's
 * round amounts within the minimum and the per-tip cap, the largest four,
 * ascending; $1 by default when offered, else the smallest. Null when none
 * fits.
 */
export function signedOutOfferFor(bounds: {
  minCents: number
  perTipCents: number
}): SignedOutOffer | null {
  const fits = STAND_IN_LADDER.filter(
    (c) => c >= bounds.minCents && c <= bounds.perTipCents
  ).slice(-STAND_IN_CHOICES)
  if (fits.length === 0) return null
  const amount = fits.includes(STAND_IN_DEFAULT)
    ? STAND_IN_DEFAULT
    : (fits[0] as number)
  return {
    signedOut: true,
    amount: standInMoney(amount),
    amounts: fits.map(standInMoney),
  }
}

/** Today's testnet bounds: a 10¢ minimum and a cap of about 64¢. */
const STAND_IN_SIGNED_OUT_OFFER = signedOutOfferFor({
  minCents: 10,
  perTipCents: 64,
})

const absentTip: TipController = {
  state: { phase: 'idle' },
  amount: null,
  blocked: null,
  amounts: [],
  setAmount: () => {},
  tip: async () => {},
  reset: () => {},
  ready: true,
  warming: false,
  queued: false,
  unavailable: 'absent',
  signedOut: STAND_IN_SIGNED_OUT_OFFER,
}
const absentBalance: BalanceView = {
  status: 'unavailable',
  available: null,
  online: true,
}

/** No payments shell on the page: the reading view stays complete. */
export const absentRuntime: ReadPaymentsRuntime = {
  useBalance: () => absentBalance,
  useTip: () => absentTip,
}

export const ReadPaymentsContext =
  createContext<ReadPaymentsRuntime>(absentRuntime)

/** The tip control for the article or a chosen line. */
export function useTip(target: TipTarget, meta: TipMeta): TipController {
  return useContext(ReadPaymentsContext).useTip(target, meta)
}

/** The reader's balance. */
export function useBalance(): BalanceView {
  return useContext(ReadPaymentsContext).useBalance()
}
