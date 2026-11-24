import { query, type QueryCtx } from './_generated/server'
import { v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { handleKey } from '../lib/profile/handleRules'

async function hasPublishedArticle(
  ctx: QueryCtx,
  authorId: Id<'users'>,
  slug: string
) {
  const article = await ctx.db
    .query('articles')
    .withIndex('by_slug', (q) => q.eq('slug', slug))
    .filter((q) =>
      q.and(
        q.eq(q.field('authorId'), authorId),
        q.eq(q.field('published'), true)
      )
    )
    .first()
  return article !== null
}

/**
 * Used by the request proxy before a writer or article page renders:
 * - found: the page exists under this exact handle.
 * - moved: the handle is a writer's earlier handle, or differs only in letter
 *   case; redirect to their current handle.
 * - missing: answer 404.
 * Drafts count as missing. Returns no other data.
 */
export const resolvePublicRoute = query({
  args: { username: v.string(), slug: v.optional(v.string()) },
  returns: v.union(
    v.object({ kind: v.literal('found') }),
    v.object({ kind: v.literal('missing') }),
    v.object({ kind: v.literal('moved'), username: v.string() })
  ),
  handler: async (ctx, { username, slug }) => {
    const exact = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', username))
      .first()
    if (exact) {
      if (slug === undefined) return { kind: 'found' as const }
      return (await hasPublishedArticle(ctx, exact._id, slug))
        ? { kind: 'found' as const }
        : { kind: 'missing' as const }
    }

    const key = handleKey(username)
    const sameHandle = await ctx.db
      .query('users')
      .withIndex('by_username_lower', (q) => q.eq('usernameLower', key))
      .first()
    let target = sameHandle
    if (!target) {
      const retired = await ctx.db
        .query('usernameHistory')
        .withIndex('by_username_lower', (q) => q.eq('usernameLower', key))
        .first()
      target = retired ? await ctx.db.get(retired.userId) : null
    }
    if (!target) return { kind: 'missing' as const }
    if (
      slug !== undefined &&
      !(await hasPublishedArticle(ctx, target._id, slug))
    )
      return { kind: 'missing' as const }
    return { kind: 'moved' as const, username: target.username }
  },
})

/**
 * Kept so a frontend deployed before resolvePublicRoute keeps answering 404s
 * while Vercel and Convex deploys land at different times. Exact handles only.
 * Remove once no deployed frontend calls it.
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
    return hasPublishedArticle(ctx, author._id, slug)
  },
})
