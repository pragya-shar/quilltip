'use node'

import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { internal } from './_generated/api'

// Main upload action (background job) - Node.js runtime
export const uploadArticleToArweave = internalAction({
  args: { articleId: v.id('articles') },
  handler: async (ctx, args) => {
    // Check if Arweave is enabled
    const enabled = process.env.ARWEAVE_ENABLED === 'true'
    if (!enabled) {
      return
    }

    const walletKey = process.env.ARWEAVE_WALLET_KEY
    if (!walletKey) {
      console.error('[Arweave] ARWEAVE_WALLET_KEY not configured')
      await ctx.runMutation(internal.arweaveHelpers.recordArweaveFailure, {
        articleId: args.articleId,
        error: 'Wallet key not configured',
      })
      return
    }

    // Get article data via helper query
    const data = await ctx.runQuery(
      internal.arweaveHelpers.getArticleForUpload,
      {
        articleId: args.articleId,
      }
    )

    if (!data) {
      console.error('[Arweave] Article not found:', args.articleId)
      return
    }

    const { article, authorUsername } = data

    // Dynamic import for Node.js module
    const { uploadArticle, parseWalletKey } =
      await import('../lib/arweave/client')

    const content = {
      title: article.title,
      body: article.content,
      author: authorUsername,
      authorId: article.authorId,
      timestamp: Date.now(),
      version: (article.contentVersion || 0) + 1,
    }

    // Retry logic with exponential backoff
    const maxRetries = 3
    let lastError = ''

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await uploadArticle(content, parseWalletKey(walletKey))

        if (result.success && result.txId) {
          await ctx.runMutation(internal.arweaveHelpers.recordArweaveUpload, {
            articleId: args.articleId,
            txId: result.txId,
            url: result.url || `https://arweave.net/${result.txId}`,
            version: content.version,
            contentHash: result.contentHash,
          })
          return
        }

        lastError = result.error || 'Unknown error'
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error'
      }

      // Exponential backoff before retry
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    // All retries failed
    await ctx.runMutation(internal.arweaveHelpers.recordArweaveFailure, {
      articleId: args.articleId,
      error: lastError,
    })
    console.error(
      `[Arweave] Upload failed after ${maxRetries} attempts:`,
      lastError
    )
  },
})

// Maximum verification attempts (~2 hours with 10-min intervals)
const MAX_VERIFY_ATTEMPTS = 12

// Verification action - checks if transaction is confirmed on Arweave
export const verifyArweaveUpload = internalAction({
  args: { articleId: v.id('articles') },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(
      internal.arweaveHelpers.getArticleForUpload,
      {
        articleId: args.articleId,
      }
    )

    if (!data?.article.arweaveTxId) {
      return
    }

    // Skip if already verified or failed
    if (
      data.article.arweaveStatus === 'verified' ||
      data.article.arweaveStatus === 'failed'
    ) {
      return
    }

    // Track attempts to prevent infinite loops
    const attempts = (data.article.arweaveVerifyAttempts || 0) + 1

    if (attempts > MAX_VERIFY_ATTEMPTS) {
      // Max retries exceeded - mark as failed
      await ctx.runMutation(internal.arweaveHelpers.recordArweaveFailure, {
        articleId: args.articleId,
        error: `Verification timed out after ${MAX_VERIFY_ATTEMPTS} attempts (~2 hours)`,
      })
      console.error(
        `[Arweave] Verification timeout for: ${data.article.arweaveTxId}`
      )
      return
    }

    // Update attempt count
    await ctx.runMutation(internal.arweaveHelpers.updateVerifyAttempts, {
      articleId: args.articleId,
      attempts,
    })

    const { getTransactionStatus } = await import('../lib/arweave/client')
    const status = await getTransactionStatus(data.article.arweaveTxId)

    if (status.confirmed) {
      await ctx.runMutation(internal.arweaveHelpers.updateArweaveStatus, {
        articleId: args.articleId,
        status: 'verified',
      })
    } else {
      // Retry in 10 minutes if not confirmed yet
      await ctx.scheduler.runAfter(
        10 * 60 * 1000,
        internal.arweave.verifyArweaveUpload,
        { articleId: args.articleId }
      )
    }
  },
})
