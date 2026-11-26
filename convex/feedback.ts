import { ConvexError, v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { internalMutation, internalQuery, mutation } from './_generated/server'
import { consumeFixedWindow } from './lib/fixedWindowLimit'

export const FEEDBACK_MIN_LENGTH = 10
export const FEEDBACK_MAX_LENGTH = 2_000
export const FEEDBACK_LIMIT_PER_HOUR = 5
const HOUR_MS = 60 * 60 * 1000

const categoryValidator = v.union(
  v.literal('bug'),
  v.literal('idea'),
  v.literal('question'),
  v.literal('other')
)

function cleanPath(path: string | undefined): string | undefined {
  if (!path || !path.startsWith('/')) return undefined
  // Drop query strings and fragments; they can carry personal data.
  return path.split(/[?#]/)[0]!.slice(0, 200)
}

export const submit = mutation({
  args: {
    category: categoryValidator,
    message: v.string(),
    pagePath: v.optional(v.string()),
  },
  returns: v.object({ ok: v.literal(true) }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new ConvexError('Log in to send feedback.')

    const message = args.message.trim()
    if (message.length < FEEDBACK_MIN_LENGTH) {
      throw new ConvexError(
        `Write at least ${FEEDBACK_MIN_LENGTH} characters so we can act on it.`
      )
    }
    if (message.length > FEEDBACK_MAX_LENGTH) {
      throw new ConvexError(
        `Keep feedback under ${FEEDBACK_MAX_LENGTH.toLocaleString('en-US')} characters.`
      )
    }

    const limit = await consumeFixedWindow(
      ctx,
      `feedback:${userId}`,
      FEEDBACK_LIMIT_PER_HOUR,
      HOUR_MS
    )
    if (!limit.ok) {
      const minutes = Math.max(1, Math.ceil(limit.retryAfterMs / 60_000))
      throw new ConvexError(
        `You've sent a lot of feedback this hour. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`
      )
    }

    await ctx.db.insert('feedback', {
      userId,
      category: args.category,
      message,
      pagePath: cleanPath(args.pagePath),
      status: 'new',
      createdAt: Date.now(),
    })
    return { ok: true as const }
  },
})

/** Owner tool: newest feedback first. */
export const listRecent = internalQuery({
  args: {
    status: v.optional(v.union(v.literal('new'), v.literal('reviewed'))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(1, args.limit ?? 50), 200)
    const rows = await ctx.db
      .query('feedback')
      .withIndex('by_status_created', (q) =>
        q.eq('status', args.status ?? 'new')
      )
      .order('desc')
      .take(limit)
    return Promise.all(
      rows.map(async (row) => {
        const user = await ctx.db.get(row.userId)
        return {
          id: row._id,
          category: row.category,
          message: row.message,
          pagePath: row.pagePath,
          createdAt: row.createdAt,
          username: user?.username,
          isTestAccount: user?.isTestAccount === true,
        }
      })
    )
  },
})

export const markReviewed = internalMutation({
  args: { id: v.id('feedback') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: 'reviewed' })
  },
})
