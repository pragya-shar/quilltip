import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/** The Write backend's tables (`convex/write.ts`). Spread into `convex/schema.ts`. */
export const writeTables = {
  /**
   * The editor's device id for a draft (`l-<uuid>`), per author. A create that
   * repeats a known id returns that draft, so a create that timed out or was
   * cut off by a reload never makes a second article.
   */
  draftClientIds: defineTable({
    authorId: v.id('users'),
    clientId: v.string(),
    articleId: v.id('articles'),
    createdAt: v.number(),
  })
    .index('by_author_client', ['authorId', 'clientId'])
    .index('by_article', ['articleId']),

  /**
   * One small row per article for the desk (`convex/lib/write/deskRow.ts`):
   * what the desk lists, so its pages never read article documents. Written
   * in the same mutation as every write that changes one of these fields,
   * and removed with the article.
   */
  deskRows: defineTable({
    articleId: v.id('articles'),
    authorId: v.id('users'),
    published: v.boolean(),
    /** As stored; '' for an untitled draft. */
    title: v.string(),
    /** The first non-empty paragraph, cut on a word (`firstLineOf`). */
    firstLine: v.string(),
    words: v.number(),
    updatedAt: v.number(),
    publishedAt: v.union(v.number(), v.null()),
    slug: v.string(),
  })
    .index('by_article', ['articleId'])
    .index('by_author_published_updated', [
      'authorId',
      'published',
      'updatedAt',
    ])
    .index('by_author_published_at', ['authorId', 'published', 'publishedAt']),

  /** The desk rows backfill's position (one row, key `desk`). */
  deskRowBackfills: defineTable({
    key: v.literal('desk'),
    phase: v.union(v.literal('articles'), v.literal('rows')),
    cursor: v.union(v.string(), v.null()),
    rows: v.number(),
    changed: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_key', ['key']),
}
