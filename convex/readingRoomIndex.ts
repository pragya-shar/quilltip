import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import {
  getReadingRoomIndexState,
  syncReadingRoomArticle,
} from './lib/readingRoomIndex'

export const backfill = internalMutation({
  args: {},
  returns: v.object({ complete: v.boolean() }),
  handler: async (ctx) => {
    const state = await getReadingRoomIndexState(ctx)
    if (state?.complete) return { complete: true }

    const batch = await ctx.db
      .query('articles')
      .withIndex('by_published', (q) => q.eq('published', true))
      .paginate({
        cursor: state?.cursor ?? null,
        numItems: 8,
        maximumBytesRead: 3 * 1024 * 1024,
      })
    for (const article of batch.page) {
      await syncReadingRoomArticle(ctx, article._id, article)
    }
    const next = {
      cursor: batch.isDone ? null : batch.continueCursor,
      complete: batch.isDone,
    }
    if (state) await ctx.db.patch(state._id, next)
    else await ctx.db.insert('readingRoomIndexState', { version: 1, ...next })
    if (!batch.isDone)
      await ctx.scheduler.runAfter(0, internal.readingRoomIndex.backfill, {})
    return { complete: batch.isDone }
  },
})
