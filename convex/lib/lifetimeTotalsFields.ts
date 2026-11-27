import { v } from 'convex/values'

/**
 * Validators for the lifetime totals on `authorEarnings` (#552). Kept apart
 * from `lifetimeEarnings.ts` so that `schema.ts` imports only `convex/values`.
 */
export const lifetimeTotalsValidator = v.object({
  v1TipCount: v.number(),
  v1EarnedCents: v.number(),
  v1ShareStroops: v.string(),
  v1UnpricedTipCount: v.number(),
  tabTipCount: v.number(),
  tabEarnedCents: v.number(),
  tabSettledBaseUnits: v.record(v.string(), v.string()),
  walletEarnedBaseUnits: v.record(v.string(), v.string()),
})

/** Progress of one row's rebuild from its history, stored on the row. */
export const lifetimeRebuildValidator = v.object({
  /** Tip rows of `tips`, then `highlightTips` (`by_author`), then tab pairs. */
  phase: v.union(
    v.literal('tips'),
    v.literal('highlightTips'),
    v.literal('pairs')
  ),
  cursor: v.union(v.string(), v.null()),
  /** `_creationTime` of the last row read in the current table or address. */
  lastCreationTime: v.union(v.number(), v.null()),
  /** Writer addresses whose tab pairs are read, in order. */
  writers: v.array(v.string()),
  writerIndex: v.number(),
  /** v1 and tab totals of the rows read, and of later credits to them. */
  totals: lifetimeTotalsValidator,
  /** `earnedNet` of the pairs read, and later changes to them, per token. */
  pairNet: v.record(v.string(), v.string()),
  /** Changes to pairs of addresses not (yet) listed: address → token → units. */
  unlistedPairNet: v.record(v.string(), v.record(v.string(), v.string())),
  startedAt: v.number(),
  steps: v.number(),
})

export const lifetimeTotalsFields = {
  v1TipCount: v.optional(v.number()),
  v1EarnedCents: v.optional(v.number()),
  v1ShareStroops: v.optional(v.string()),
  v1UnpricedTipCount: v.optional(v.number()),
  tabTipCount: v.optional(v.number()),
  tabEarnedCents: v.optional(v.number()),
  tabSettledBaseUnits: v.optional(v.record(v.string(), v.string())),
  walletEarnedBaseUnits: v.optional(v.record(v.string(), v.string())),
  /** Set when the totals cover the row's whole history. */
  lifetimeTotalsAt: v.optional(v.number()),
  lifetimeRebuild: v.optional(lifetimeRebuildValidator),
  /** When the rebuild last advanced; orders the rebuild queue. */
  lifetimeRebuildTurnAt: v.optional(v.number()),
  /** The last rebuild error for the row; cleared when the row is rebuilt. */
  lifetimeRebuildError: v.optional(v.string()),
  /** Set when a step failed: the row is skipped until `retryFailed`. */
  lifetimeRebuildFailedAt: v.optional(v.number()),
}
