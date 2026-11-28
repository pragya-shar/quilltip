import type {
  ExpressionOrValue,
  FilterBuilder,
  NamedTableInfo,
} from 'convex/server'
import type { DataModel } from '../_generated/dataModel'

// A tip counts toward public totals, earnings and stats only after the server
// has verified its Stellar transaction. Verification stamps `verifiedAt`; a
// CONFIRMED row without it was never verified and is excluded everywhere.

export const CONFIRMED_TIP_STATUS = 'CONFIRMED'

// Status for legacy rows that were marked CONFIRMED before server
// verification existed. The row stays readable in the tipper's own history.
export const UNVERIFIED_TIP_STATUS = 'UNVERIFIED'
export const LEGACY_UNVERIFIED_TIP_REASON =
  'Recorded before server verification. Not counted in totals.'

type TipLike = { status: string; verifiedAt?: number }

export function isVerifiedTip(tip: TipLike): boolean {
  return (
    tip.status === CONFIRMED_TIP_STATUS &&
    typeof tip.verifiedAt === 'number' &&
    tip.verifiedAt > 0
  )
}

type TipsInfo = NamedTableInfo<DataModel, 'tips'>
type HighlightTipsInfo = NamedTableInfo<DataModel, 'highlightTips'>

/** Query filter that keeps only server-verified CONFIRMED tips. */
export function verifiedTipFilter(
  q: FilterBuilder<TipsInfo>
): ExpressionOrValue<boolean>
export function verifiedTipFilter(
  q: FilterBuilder<HighlightTipsInfo>
): ExpressionOrValue<boolean>
export function verifiedTipFilter(
  q: FilterBuilder<TipsInfo> | FilterBuilder<HighlightTipsInfo>
): ExpressionOrValue<boolean> {
  const builder = q as FilterBuilder<TipsInfo>
  return builder.and(
    builder.eq(builder.field('status'), CONFIRMED_TIP_STATUS),
    builder.gt(builder.field('verifiedAt'), 0)
  )
}

/**
 * Builds the status patch that confirms a tip. Confirmation is only possible
 * with a verification timestamp, so no code path can mark a tip CONFIRMED
 * without the server having verified it.
 */
export function confirmedTipPatch(verifiedAt: number) {
  if (!Number.isFinite(verifiedAt) || verifiedAt <= 0) {
    throw new Error('A tip can be confirmed only with a verification time')
  }
  return {
    status: CONFIRMED_TIP_STATUS,
    verifiedAt,
    processedAt: verifiedAt,
    updatedAt: verifiedAt,
  } as const
}
