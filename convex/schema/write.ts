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
}
