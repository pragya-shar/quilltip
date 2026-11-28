import { ConvexError, v } from 'convex/values'
import { verifiedTipFilter } from './lib/verifiedTips'
import { query, mutation } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { syncReadingRoomWriter } from './lib/readingRoomIndex'
import { isArticleListingReady } from './lib/articleListingReady'
import { syncAvatarUploadReference } from './lib/uploadReferences'
import { verifiedStellarAddress } from './lib/walletVerification'
import { profileBioError, profileNameError } from '../lib/profile/profileRules'
import {
  avatarSourceRefusal,
  isAllowedImageSource,
} from '../lib/security/imageSources'

// Get the current authenticated user
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null

    const user = await ctx.db.get(userId)
    if (!user) return null
    const { hashedPassword: _, ...safeUser } = user
    return safeUser
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
      // Only a verified address is public: tips go to it.
      stellarAddress: verifiedStellarAddress(user),
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

    // An address is linked only through proof of control
    // (walletLink.verifyWalletChallenge). Here it can only be removed.
    if (args.stellarAddress) {
      throw new ConvexError(
        'Verify the wallet to link it: connect it and approve the request in your wallet.'
      )
    }

    // The same rules as the profile forms, so a direct call cannot skip them.
    const name = args.name === undefined ? undefined : args.name.trim()
    const bio = args.bio === undefined ? undefined : args.bio.trim()
    if (name !== undefined) {
      const message = profileNameError(name)
      if (message) throw new ConvexError(message)
    }
    if (bio !== undefined) {
      const message = profileBioError(bio)
      if (message) throw new ConvexError(message)
    }
    // A photo address only from this deployment's storage or the listed hosts
    // (lib/security/imageSources.ts, #633). An empty address removes it.
    if (
      args.avatar?.trim() &&
      !isAllowedImageSource(args.avatar.trim(), process.env.CONVEX_CLOUD_URL)
    ) {
      throw new ConvexError(avatarSourceRefusal(args.avatar.trim()))
    }

    const updates: {
      name?: string
      bio?: string
      avatar?: string
      stellarAddress?: string | null
      stellarAddressVerifiedAt?: undefined
      stellarAddressVerifiedNetwork?: undefined
      updatedAt?: number
    } = {}
    // Use 'in' operator to check if property exists in args
    // This allows setting fields to null (needed for wallet disconnect)
    if ('name' in args) updates.name = name
    // An empty bio removes it (patching a field to undefined clears it).
    if ('bio' in args) updates.bio = bio || undefined
    if ('avatar' in args) updates.avatar = args.avatar
    if ('stellarAddress' in args) {
      updates.stellarAddress = null
      updates.stellarAddressVerifiedAt = undefined
      updates.stellarAddressVerifiedNetwork = undefined
    }

    updates.updatedAt = Date.now()

    if ('avatar' in args) {
      const user = await ctx.db.get(userId)
      await syncAvatarUploadReference(ctx, userId, user?.avatar, args.avatar)
    }
    await ctx.db.patch(userId, updates)
    const updated = await ctx.db.get(userId)
    if (!updated) return null
    if ('name' in args) await syncReadingRoomWriter(ctx, updated)
    const { hashedPassword: _, ...safeUser } = updated
    return safeUser
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
    await syncAvatarUploadReference(ctx, userId, user.avatar, undefined)
    delete next.avatar
    await ctx.db.replace(userId, next)
    const updated = await ctx.db.get(userId)
    if (!updated) return null
    const { hashedPassword: _, ...safeUser } = updated
    return safeUser
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
    const listingReadyCount = articles.filter(isArticleListingReady).length

    // Get total tips received
    const tipsReceived = await ctx.db
      .query('tips')
      .withIndex('by_author', (q) => q.eq('authorId', userId))
      .filter(verifiedTipFilter)
      .collect()

    const totalEarnings = tipsReceived.reduce(
      (sum, tip) => sum + tip.amountUsd,
      0
    )

    return {
      articleCount: listingReadyCount,
      totalEarnings,
      tipsReceivedCount: tipsReceived.length,
    }
  },
})
