import { defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Passage share links (`/p/<code>`, `convex/shares.ts`). Spread into
 * `convex/schema.ts`.
 */
export const passagesTables = {
  shares: defineTable({
    /** 8 characters, random, from `SHARE_CODE_ALPHABET`. */
    code: v.string(),
    articleId: v.id('articles'),
    /**
     * The passage's id at share time (`lib/passages/sentences.ts`). Null once
     * the quote is cleared: a cleared row keeps only its code and article.
     */
    passageId: v.union(v.string(), v.null()),
    /** Sentence indexes in the canonical text at share time (inclusive). */
    sentenceStart: v.union(v.number(), v.null()),
    sentenceEnd: v.union(v.number(), v.null()),
    /**
     * The passage's normalized text at share time, at most 500 characters.
     * Server only: used to find the sentence again, never returned to a
     * client, and set to null once it no longer matches the published text.
     */
    quote: v.union(v.string(), v.null()),
    /** The article's `contentVersion` at share time. */
    contentVersion: v.union(v.number(), v.null()),
    createdBy: v.optional(v.id('users')),
    createdAt: v.number(),
    /** When the quote and passage fields were cleared. */
    clearedAt: v.optional(v.number()),
  })
    .index('by_code', ['code'])
    .index('by_article_passage', ['articleId', 'passageId']),
}
