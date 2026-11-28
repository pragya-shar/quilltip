'use client'

/**
 * The money layer as the reading view uses it: `useTip` and `useBalance`
 * from `hooks/payments`, the types from `lib/payments/types`, targets from
 * `lib/payments/target` and amounts from `lib/payments/money`. Its README
 * is the contract. Nothing here formats, rounds or adds money.
 *
 * One extension is ahead of the layer and inert until it lands: a short
 * `holding` phase before sending, and the controller's `hold` controls. The
 * layer never reports them today, so a tip sends at once.
 */
import { useTip as useLayerTip } from '@/hooks/payments/useTip'
import type {
  TipController as LayerTipController,
  TipMeta,
  TipPhase as LayerTipPhase,
  TipTarget,
  Money,
} from '@/lib/payments/types'
import type { TipHold } from '@/system/components/TipControl'

export { useBalance } from '@/hooks/payments/useBalance'
export { articleIdOf, tipTargetOf } from '@/lib/payments/target'
export { formatMoney } from '@/lib/payments/money'
export type {
  BalanceView,
  Cents,
  Money,
  PassageRef,
  TipMeta,
  TipTarget,
  UnavailableReason,
} from '@/lib/payments/types'

/** The layer's phases, and the hold planned before sending (inert). */
export type TipPhase = LayerTipPhase | { phase: 'holding'; amount: Money }

/** The layer's controller, with the planned hold's controls (inert). */
export type TipController = Omit<LayerTipController, 'state'> & {
  state: TipPhase
  hold?: TipHold | null
}

/** The tip control for the article or a chosen line. */
export function useTip(target: TipTarget, meta: TipMeta): TipController {
  return useLayerTip(target, meta)
}
