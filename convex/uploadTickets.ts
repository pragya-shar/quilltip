import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './lib/imageUpload'

export const create = internalMutation({
  args: { tokenHash: v.string(), userId: v.id('users') },
  handler: async (ctx, { tokenHash, userId }) => {
    const active = await ctx.db
      .query('uploadTickets')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(20)
    if (active.length >= 20)
      throw new Error('Too many pending uploads. Try again shortly.')
    const ticketId = await ctx.db.insert('uploadTickets', {
      tokenHash,
      userId,
      expiresAt: Date.now() + 5 * 60_000,
    })
    await ctx.scheduler.runAfter(5 * 60_000, internal.uploadTickets.expire, {
      ticketId,
    })
  },
})

export const expire = internalMutation({
  args: { ticketId: v.id('uploadTickets') },
  handler: async (ctx, { ticketId }) => {
    if (await ctx.db.get(ticketId)) await ctx.db.delete(ticketId)
  },
})

export const consume = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const ticket = await ctx.db
      .query('uploadTickets')
      .withIndex('by_hash', (q) => q.eq('tokenHash', tokenHash))
      .unique()
    if (!ticket || ticket.expiresAt <= Date.now()) return null
    await ctx.db.delete(ticket._id)
    return ticket.userId
  },
})

export const recordOwner = internalMutation({
  args: {
    storageId: v.id('_storage'),
    userId: v.id('users'),
    fileType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { storageId, userId, fileType }) => {
    const metadata = await ctx.db.system.get(storageId)
    if (
      !metadata ||
      metadata.size > MAX_IMAGE_BYTES ||
      !IMAGE_TYPES.includes(fileType) ||
      !(await ctx.db.get(userId))
    )
      throw new Error('Upload no longer available')
    const existing = await ctx.db
      .query('uploadOwners')
      .withIndex('by_storage', (q) => q.eq('storageId', storageId))
      .unique()
    if (existing) throw new Error('Upload ownership already recorded')
    const url = await ctx.storage.getUrl(storageId)
    if (!url) throw new Error('Upload no longer available')
    await ctx.db.insert('uploadOwners', {
      storageId,
      userId,
      fileType,
      url,
      referencesTracked: true,
    })
    return null
  },
})
