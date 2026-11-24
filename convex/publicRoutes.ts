import { query } from './_generated/server'
import { v } from 'convex/values'

/**
 * Cheap existence check used by the request proxy to answer 404 before a page
 * starts streaming. Mirrors what the pages can show: a writer by username, or a
 * published article by that writer. Returns a boolean only.
 */
export const publicRouteExists = query({
  args: { username: v.string(), slug: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, { username, slug }) => {
    const author = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', username))
      .first()
    if (!author) return false
    if (slug === undefined) return true

    const article = await ctx.db
      .query('articles')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .filter((q) =>
        q.and(
          q.eq(q.field('authorId'), author._id),
          q.eq(q.field('published'), true)
        )
      )
      .first()
    return article !== null
  },
})
