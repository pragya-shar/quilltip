import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'

/**
 * Validate Stellar address format
 * Stellar addresses start with G and are 56 characters (base32)
 */
function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address)
}

// Get the current authenticated user
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null

    return await ctx.db.get(userId)
  },
})

// Get user by username
export const getUserByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', args.username))
      .first()
    if (!user) return null
    // Return only public fields
    return {
      _id: user._id,
      _creationTime: user._creationTime,
      name: user.name,
      username: user.username,
      bio: user.bio,
      avatar: user.avatar,
      stellarAddress: user.stellarAddress,
      articleCount: user.articleCount,
      highlightCount: user.highlightCount,
      nftsCreated: user.nftsCreated,
      nftsOwned: user.nftsOwned,
      createdAt: user.createdAt,
    }
  },
})

// Update user profile
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    bio: v.optional(v.string()),
    avatar: v.optional(v.string()),
    stellarAddress: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    // Validate Stellar address format if provided
    if (args.stellarAddress && !isValidStellarAddress(args.stellarAddress)) {
      throw new Error(
        "Invalid Stellar address format. Address must start with 'G' and be 56 characters."
      )
    }

    const updates: {
      name?: string
      bio?: string
      avatar?: string
      stellarAddress?: string | null
      updatedAt?: number
    } = {}
    // Use 'in' operator to check if property exists in args
    // This allows setting fields to null (needed for wallet disconnect)
    if ('name' in args) updates.name = args.name
    if ('bio' in args) updates.bio = args.bio
    if ('avatar' in args) updates.avatar = args.avatar
    if ('stellarAddress' in args) updates.stellarAddress = args.stellarAddress

    updates.updatedAt = Date.now()

    await ctx.db.patch(userId, updates)
    return await ctx.db.get(userId)
  },
})

// Clear profile avatar (patch cannot remove optional fields; replace omits avatar)
export const clearAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    const next = { ...user }
    delete next.avatar
    await ctx.db.replace(userId, next)
    return await ctx.db.get(userId)
  },
})

// Complete onboarding
export const completeOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    await ctx.db.patch(userId, {
      onboardingCompleted: true,
      updatedAt: Date.now(),
    })
  },
})

// Check if username is available
export const isUsernameAvailable = query({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', args.username))
      .first()
    return !existing
  },
})

// Get user stats
export const getUserStats = query({
  args: { userId: v.optional(v.id('users')) },
  handler: async (ctx, args) => {
    const userId = args.userId || (await getAuthUserId(ctx))
    if (!userId) return null

    const user = await ctx.db.get(userId)
    if (!user) return null

    // Get article count
    const articles = await ctx.db
      .query('articles')
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .filter((q) => q.eq(q.field('published'), true))
      .collect()

    // Get total tips received
    const tipsReceived = await ctx.db
      .query('tips')
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .collect()

    const totalEarnings = tipsReceived.reduce(
      (sum, tip) => sum + tip.amountUsd,
      0
    )

    return {
      articleCount: articles.length,
      totalEarnings,
      tipsReceivedCount: tipsReceived.length,
    }
  },
})
