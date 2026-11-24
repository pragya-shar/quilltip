import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { getAuthUserId } from '@convex-dev/auth/server'
import {
  MAX_RETIRED_HANDLES,
  handleFormatError,
  handleKey,
} from '../lib/profile/handleRules'
import { findHandleOwner } from './lib/handleOwner'
import {
  syncReadingRoomArticle,
  syncReadingRoomWriter,
} from './lib/readingRoomIndex'

const handleStatusValidator = v.union(
  v.object({ status: v.literal('current') }),
  v.object({ status: v.literal('available') }),
  v.object({ status: v.literal('taken') }),
  v.object({ status: v.literal('invalid'), message: v.string() })
)

/** Live check for the handle field in the writer's profile. */
export const checkHandle = query({
  args: { handle: v.string() },
  returns: handleStatusValidator,
  handler: async (ctx, { handle }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    const trimmed = handle.trim()
    if (trimmed === user.username) return { status: 'current' as const }
    const message = handleFormatError(trimmed)
    if (message) return { status: 'invalid' as const, message }
    const owner = await findHandleOwner(ctx, trimmed)
    return owner && owner.userId !== userId
      ? { status: 'taken' as const }
      : { status: 'available' as const }
  },
})

/**
 * Changes the signed-in writer's handle. The old handle stays reserved for
 * them and redirects; their articles and Reading Room rows get the new one.
 */
export const changeHandle = mutation({
  args: { handle: v.string() },
  returns: v.object({ username: v.string() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    const handle = args.handle.trim()
    if (handle === user.username) return { username: handle }
    const message = handleFormatError(handle)
    if (message) throw new ConvexError(message)

    const owner = await findHandleOwner(ctx, handle)
    if (owner && owner.userId !== userId) {
      throw new ConvexError('That handle is taken.')
    }

    const key = handleKey(handle)
    const oldKey = handleKey(user.username)
    const history = await ctx.db
      .query('usernameHistory')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    // Switching back to one of the writer's own earlier handles.
    const reclaimed = history.find((row) => row.usernameLower === key)
    const now = Date.now()

    if (oldKey !== key) {
      const remaining = history.length - (reclaimed ? 1 : 0)
      if (remaining >= MAX_RETIRED_HANDLES) {
        throw new ConvexError(
          `You can keep up to ${MAX_RETIRED_HANDLES} earlier handles. Switch back to one of them instead.`
        )
      }
      await ctx.db.insert('usernameHistory', {
        userId,
        username: user.username,
        usernameLower: oldKey,
        retiredAt: now,
      })
    }
    if (reclaimed) await ctx.db.delete(reclaimed._id)

    await ctx.db.patch(userId, {
      username: handle,
      usernameLower: key,
      updatedAt: now,
    })

    const updated = await ctx.db.get(userId)
    if (updated) await syncReadingRoomWriter(ctx, updated)
    // Articles keep a copy of the handle for links and search. Update them in
    // small batches so a large archive cannot exceed transaction limits;
    // until then, links with the old copy go through the redirect.
    await ctx.scheduler.runAfter(0, internal.handles.syncAuthorHandle, {
      userId,
      cursor: null,
    })

    return { username: handle }
  },
})

const HANDLE_SYNC_BATCH = 25

/** Copies the writer's current handle onto their articles, one batch a run. */
export const syncAuthorHandle = internalMutation({
  args: {
    userId: v.id('users'),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { userId, cursor }) => {
    // Re-read each batch, so a later rename always wins.
    const user = await ctx.db.get(userId)
    if (!user) return null
    const page = await ctx.db
      .query('articles')
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .paginate({ numItems: HANDLE_SYNC_BATCH, cursor })
    for (const article of page.page) {
      if (article.authorUsername === user.username) continue
      const next = { ...article, authorUsername: user.username }
      await ctx.db.patch(article._id, { authorUsername: user.username })
      await syncReadingRoomArticle(ctx, article._id, next)
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.handles.syncAuthorHandle, {
        userId,
        cursor: page.continueCursor,
      })
    }
    return null
  },
})

/**
 * One-off after deploy: fill usernameLower for accounts created before it
 * existed. Run with dryRun first; collisions list handles that differ only by
 * letter case and need a manual decision.
 */
export const backfillUsernameLower = internalMutation({
  args: { dryRun: v.boolean() },
  returns: v.object({
    total: v.number(),
    toUpdate: v.number(),
    collisions: v.array(v.array(v.string())),
  }),
  handler: async (ctx, { dryRun }) => {
    const users = await ctx.db.query('users').collect()
    const byKey = new Map<string, string[]>()
    let toUpdate = 0
    for (const user of users) {
      const key = handleKey(user.username)
      byKey.set(key, [...(byKey.get(key) ?? []), user.username])
      if (user.usernameLower === key) continue
      toUpdate += 1
      if (!dryRun) await ctx.db.patch(user._id, { usernameLower: key })
    }
    return {
      total: users.length,
      toUpdate,
      collisions: [...byKey.values()].filter((names) => names.length > 1),
    }
  },
})
