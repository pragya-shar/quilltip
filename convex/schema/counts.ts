import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Tip counts per article and per passage (`convex/lib/counts/sync.ts`).
 * Spread into `convex/schema.ts`. Only `syncTipCounts` writes these tables.
 *
 * Every figure is a running total kept in the same mutation as the tip's
 * status change, never a scan. A reader figure (`distinctTippers`) counts
 * signed-in tippers only; tips without a known tipper are counted apart in
 * `unidentifiedTipCount`, so copy can say "N tips" whenever that is above 0.
 */
const figures = {
  /** Counted tips. */
  tipCount: v.number(),
  /** Their amounts in integer US cents, at each tip's own quote. */
  tipCents: v.number(),
  /** Distinct signed-in tippers with at least one counted tip here. */
  distinctTippers: v.number(),
  /** Counted tips whose tipper is not a known signed-in user. */
  unidentifiedTipCount: v.number(),
  /** Creation time of the earliest and latest tip ever counted here. */
  firstTipAt: v.optional(v.number()),
  lastTipAt: v.optional(v.number()),
  updatedAt: v.number(),
}

export const tipSourceValidator = v.union(
  v.literal('tips'),
  v.literal('highlightTips')
)

export const countsTables = {
  /**
   * What one tip row adds to the figures now: the idempotency record. A sync
   * compares the row's current state with this entry and applies only the
   * difference, so a retry, a replayed event or a repeated status change
   * writes nothing. The article, passage and reader are fixed when the row is
   * first counted, so a later edit of the article never moves a tip.
   */
  tipCountEntries: defineTable({
    source: tipSourceValidator,
    rowId: v.string(),
    articleId: v.id('articles'),
    passageId: v.union(v.string(), v.null()),
    /** `u:<userId>` for a signed-in tipper; null when not known. */
    readerKey: v.union(v.string(), v.null()),
    /** True while the row adds `cents` and one tip to the figures. */
    live: v.boolean(),
    cents: v.number(),
    /** The tip row's creation time, for first and last tip. */
    tipAt: v.number(),
    /** The state the entry was last synced from, for audits. */
    syncedState: v.string(),
    updatedAt: v.number(),
  })
    .index('by_source_row', ['source', 'rowId'])
    .index('by_article', ['articleId']),

  articleTipStats: defineTable({
    articleId: v.id('articles'),
    ...figures,
  })
    .index('by_article', ['articleId'])
    .index('by_tipCount', ['tipCount']),

  passageStats: defineTable({
    articleId: v.id('articles'),
    passageId: v.string(),
    /** The writer the tips paid (the tip rows' `authorId`), for a writer's lines. */
    authorId: v.id('users'),
    ...figures,
    /**
     * The passage's normalized text when first counted. Server only: used to
     * find the passage in the current article text, never returned; a list
     * shows only the current text, and nothing when the passage is gone.
     */
    quote: v.union(v.string(), v.null()),
  })
    .index('by_article_passage', ['articleId', 'passageId'])
    .index('by_article_tipCount', ['articleId', 'tipCount'])
    .index('by_author_tipCount', ['authorId', 'tipCount'])
    .index('by_tipCount', ['tipCount', 'lastTipAt'])
    .index('by_lastTipAt', ['lastTipAt']),

  /**
   * One row per (scope, reader): how many of that reader's tips are counted
   * in the scope. `distinctTippers` moves when `liveTips` goes from 0 to 1 or
   * back. Rows at 0 stay, so nothing is deleted under concurrency.
   */
  tipperMemberships: defineTable({
    scope: v.union(v.literal('article'), v.literal('passage')),
    articleId: v.id('articles'),
    passageId: v.union(v.string(), v.null()),
    readerKey: v.string(),
    liveTips: v.number(),
  }).index('by_scope_key', ['scope', 'articleId', 'passageId', 'readerKey']),

  /**
   * The backfill's position (one row, key `counts`): `tips` first, then
   * `highlightTips`. Each row is synced exactly as a status change would sync
   * it, so a second run, or a run beside live tips, changes nothing.
   */
  countsBackfills: defineTable({
    key: v.literal('counts'),
    source: tipSourceValidator,
    cursor: v.union(v.string(), v.null()),
    /** Rows synced, and rows whose figures changed, in this run. */
    rows: v.number(),
    changed: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_key', ['key']),
}
