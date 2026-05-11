'use node'

import { action } from './_generated/server'
import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { internal } from './_generated/api'
import { buildNftMetadataPayload } from './lib/nftMetadata'

export const uploadNftMetadataForMint = action({
  args: {
    articleId: v.id('articles'),
    xlmPrice: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    if (process.env.ARWEAVE_ENABLED !== 'true') {
      throw new Error(
        'Arweave uploads are disabled. Set ARWEAVE_ENABLED=true in Convex environment to mint NFTs with on-chain metadata.'
      )
    }

    const walletKey = process.env.ARWEAVE_WALLET_KEY
    if (!walletKey) {
      throw new Error(
        'Arweave wallet key is not configured. Set ARWEAVE_WALLET_KEY in Convex environment to mint NFTs.'
      )
    }

    const loaded = await ctx.runQuery(
      internal.nfts.loadArticleTipsForNftMetadata,
      { articleId: args.articleId }
    )

    if (!loaded) {
      throw new Error('Article not found')
    }

    const { article, tips } = loaded
    if (article.authorId !== userId) {
      throw new Error(
        'Only the author can upload mint metadata for this article'
      )
    }

    const payload = buildNftMetadataPayload(article, tips, args.xlmPrice)

    const { uploadJsonWithTurbo, parseWalletKey } =
      await import('../lib/arweave/client')

    let jwk
    try {
      jwk = parseWalletKey(walletKey)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid wallet key'
      throw new Error(`Arweave wallet key is invalid: ${msg}`)
    }

    const extraTags = [{ name: 'Article-Id', value: args.articleId }]

    const maxRetries = 3
    let lastError = ''

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await uploadJsonWithTurbo(payload, jwk, extraTags)
        if (result.success && result.url) {
          return { metadataUrl: result.url }
        }
        lastError = result.error || 'Unknown error'
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error'
      }

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw new Error(
      `NFT metadata upload to Arweave failed after ${maxRetries} attempts: ${lastError}`
    )
  },
})
