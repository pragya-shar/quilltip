import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'

/**
 * Sanitize error messages to avoid exposing sensitive system details
 */
function sanitizeErrorMessage(error: string): string {
  const sensitivePatterns = [
    /wallet|key|secret|credential|password|token/i,
    /internal server|database|connection/i,
    /ARWEAVE_WALLET_KEY|process\.env/i,
  ]

  // If error contains sensitive info, return generic message
  if (sensitivePatterns.some((pattern) => pattern.test(error))) {
    return 'Upload failed. Please try again later.'
  }

  // Truncate long errors and remove potential stack traces
  const firstLine = error.split('\n')[0] ?? error
  return firstLine.slice(0, 200)
}

// Get article data for upload (used by arweave action)
export const getArticleForUpload = internalQuery({
  args: { articleId: v.id('articles') },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId)
    if (!article) return null

    const author = await ctx.db.get(article.authorId)
    return {
      article,
      authorUsername: author?.username || 'unknown',
    }
  },
})

// Record successful upload
export const recordArweaveUpload = internalMutation({
  args: {
    articleId: v.id('articles'),
    txId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.articleId, {
      arweaveTxId: args.txId,
      arweaveUrl: args.url,
      arweaveStatus: 'uploaded',
      arweaveTimestamp: Date.now(),
      updatedAt: Date.now(),
    })

    // Schedule verification after 10 minutes
    await ctx.scheduler.runAfter(
      10 * 60 * 1000,
      internal.arweave.verifyArweaveUpload,
      { articleId: args.articleId }
    )
  },
})

// Record upload failure with sanitized error message
export const recordArweaveFailure = internalMutation({
  args: {
    articleId: v.id('articles'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const sanitizedError = sanitizeErrorMessage(args.error)
    await ctx.db.patch(args.articleId, {
      arweaveStatus: 'failed',
      arweaveErrorMessage: sanitizedError,
      updatedAt: Date.now(),
    })
    // Log full error server-side for debugging, but store sanitized version
    console.error(
      `[Arweave] Failed for article ${args.articleId}: ${args.error}`
    )
  },
})

// Update verification attempt count
export const updateVerifyAttempts = internalMutation({
  args: {
    articleId: v.id('articles'),
    attempts: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.articleId, {
      arweaveVerifyAttempts: args.attempts,
      updatedAt: Date.now(),
    })
  },
})

// Update arweave status (for verification job)
export const updateArweaveStatus = internalMutation({
  args: {
    articleId: v.id('articles'),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.articleId, {
      arweaveStatus: args.status,
      updatedAt: Date.now(),
    })
  },
})
