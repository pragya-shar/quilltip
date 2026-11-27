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

export type Cents = number
export type Money = { cents: Cents; display: string }

export type PassageRef = {
  text: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
}

export type TipTarget =
  | { kind: 'article'; articleId: string }
  | { kind: 'passage'; articleId: string; passage: PassageRef }

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
  /**
   * For a signed-out visitor: the default and the offered amounts, from
   * public data only (minimum, cap, price), so the button says "Tip Tomás
   * $1" before sign-in. Null when signed in. Asked of the money layer (pull
   * request 561); the name may change when it lands.
   */
  signedOut: SignedOutOffer | null
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

/**
 * A stand-in for the money layer's signed-out offer until pull request 561
 * provides it: replace it with the money layer's figures. The reading view
 * never formats or computes these itself.
 */
const FAKE_SIGNED_OUT_OFFER: SignedOutOffer = {
  signedOut: true,
  amount: { cents: 100, display: '$1' },
  amounts: [
    { cents: 100, display: '$1' },
    { cents: 200, display: '$2' },
    { cents: 300, display: '$3' },
    { cents: 500, display: '$5' },
    { cents: 1000, display: '$10' },
  ],
}

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
  signedOut: FAKE_SIGNED_OUT_OFFER,
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
