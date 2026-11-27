/**
 * What a tip surface shows for a standing condition: one from the flow (a
 * refusal or a decoded contract failure) or one the server reports before
 * anything starts (`getTipEligibility`). Returns the kit's notice props and
 * the input `resolvePaymentView` needs.
 */
import type { PaymentNoticeProps } from '@/components/payments/payment-types'
import type { NoticeKind, TipsUnavailableReason } from '@/lib/payments/ui-state'
import { PREPARE_REFUSAL_COPY, BASKET_COPY } from '@/lib/copy/tip-flow'
import type { FlowCondition } from './flow'

export type ConditionView = {
  /** For `resolvePaymentView`. */
  notice: { kind: NoticeKind } | null
  tipsUnavailable: TipsUnavailableReason | null
  /** Props for `PaymentNotice`, or null for tips unavailable. */
  props: Exclude<PaymentNoticeProps, { kind: 'tips-unavailable' }> | null
}

const refused = (copy: { title: string; detail: string }): ConditionView => ({
  notice: { kind: 'refused' },
  tipsUnavailable: null,
  props: { kind: 'refused', copy },
})

export function conditionView(condition: FlowCondition): ConditionView | null {
  switch (condition.kind) {
    case 'gate':
      return null
    case 'paused':
      return {
        notice: { kind: 'paused' },
        tipsUnavailable: null,
        props: { kind: 'paused' },
      }
    case 'tips-unavailable':
      return { notice: null, tipsUnavailable: condition.reason, props: null }
    case 'basket-item-unavailable':
      return {
        notice: { kind: 'basket-item-unavailable' },
        tipsUnavailable: null,
        props: { kind: 'basket-item-unavailable' },
      }
    case 'insufficient-balance':
      return {
        notice: { kind: 'insufficient-balance' },
        tipsUnavailable: null,
        props: {
          kind: 'insufficient-balance',
          source: 'wallet',
          ...(condition.needed && condition.available
            ? { needed: condition.needed, available: condition.available }
            : {}),
        },
      }
    case 'network-busy':
      return {
        notice: { kind: 'network-busy' },
        tipsUnavailable: null,
        props: { kind: 'network-busy' },
      }
    case 'refused':
      return refused(condition.copy)
  }
}

/**
 * Conditions `getTipEligibility` reports before the reader starts. Account
 * problems (signed out, no wallet, unverified) are the wallet gate's, and
 * article problems hide the tip button, so neither shows here.
 */
export function eligibilityCondition(eligibility: {
  reason: string | null
}): ConditionView | null {
  switch (eligibility.reason) {
    case 'PAUSED':
      return {
        notice: { kind: 'paused' },
        tipsUnavailable: null,
        props: { kind: 'paused' },
      }
    case 'PRICE_UNAVAILABLE':
      return refused(PREPARE_REFUSAL_COPY.noPrice)
    case 'CHAIN_V2_DISABLED':
      return refused(PREPARE_REFUSAL_COPY.v2Disabled)
    case 'CHAIN_CONFIG_MISSING':
    case 'CHAIN_CONFIG_INVALID':
      return refused(PREPARE_REFUSAL_COPY.notConfigured)
    case 'ARTICLE_NOT_REGISTERED':
    case 'ARTICLE_NOT_FOUND':
      return { notice: null, tipsUnavailable: 'unregistered', props: null }
    case 'PAYOUT_ADDRESS_CHANGED':
      return { notice: null, tipsUnavailable: 'payout_outdated', props: null }
    case 'SELF_TIP':
      return refused(PREPARE_REFUSAL_COPY.selfTip)
    default:
      return null
  }
}

/** The note under a basket row whose article cannot take tips. */
export const BASKET_ITEM_NOTE = BASKET_COPY.itemUnavailableNote
