import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { enrichWithUser } from './lib/enrich'

// Get NFTs by owner
export const getNFTsByOwner = query({
  args: {
    ownerId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const targetOwnerId = args.ownerId || (await getAuthUserId(ctx))
    if (!targetOwnerId) return []

    const nfts = await ctx.db
      .query('articleNFTs')
      .withIndex('by_current_owner', (q) => q.eq('currentOwner', targetOwnerId))
      .collect()

    // Enrich with article data
    const enrichedNfts = await Promise.all(
      nfts.map(async (nft) => {
        const [article, minter] = await Promise.all([
          ctx.db.get(nft.articleId),
          enrichWithUser(ctx, nft.mintedBy),
        ])

        return {
          ...nft,
          article: article
            ? {
                id: article._id,
                title: article.title,
                slug: article.slug,
                excerpt: article.excerpt,
                coverImage: article.coverImage,
                authorUsername: article.authorUsername,
              }
            : null,
          minter,
        }
      })
    )

    return enrichedNfts
  },
})

// Get NFT by article
export const getNFTByArticle = query({
  args: {
    articleId: v.id('articles'),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId)
    if (!article) return null

    // Get existing NFT if it exists
    const nft = await ctx.db
      .query('articleNFTs')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .first()

    // Get total tips for the article
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .collect()

    const totalTipsUsd = tips.reduce((sum, tip) => sum + tip.amountUsd, 0)
    const totalTipsCents = Math.round(totalTipsUsd * 100)
    const thresholdCents = 1000 // $10 threshold in cents

    if (nft) {
      // NFT exists - return full NFT data with status
      const [owner, minter] = await Promise.all([
        ctx.db.get(nft.currentOwner),
        ctx.db.get(nft.mintedBy),
      ])

      // Count transfers
      const transfers = await ctx.db
        .query('nftTransfers')
        .withIndex('by_nft', (q) => q.eq('nftId', nft._id))
        .collect()

      // Calculate rarity based on total tips at mint
      let rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' =
        'common'
      const tipAmount = nft.totalTipsAtMint || totalTipsCents
      if (tipAmount >= 10000)
        rarity = 'legendary' // $100+
      else if (tipAmount >= 5000)
        rarity = 'epic' // $50+
      else if (tipAmount >= 2500)
        rarity = 'rare' // $25+
      else if (tipAmount >= 1500) rarity = 'uncommon' // $15+

      return {
        // Spread NFT data first to include _id and other fields
        ...nft,
        // Add status fields
        isMinted: true as const,
        isEligible: true,
        totalTips: totalTipsCents,
        tipThreshold: thresholdCents,
        owner: owner?.stellarAddress || owner?.username || 'Unknown',
        mintedAt: new Date(nft.mintedAt).toISOString(),
        transferCount: transfers.length,
        rarity,
        ownerInfo: owner
          ? {
              id: owner._id,
              name: owner.name,
              username: owner.username,
              avatar: owner.avatar,
              stellarAddress: owner.stellarAddress,
            }
          : null,
        minterInfo: minter
          ? {
              id: minter._id,
              name: minter.name,
              username: minter.username,
              avatar: minter.avatar,
            }
          : null,
      }
    } else {
      // No NFT - return status for minting
      const isEligible = totalTipsCents >= thresholdCents

      return {
        isMinted: false as const,
        isEligible,
        totalTips: totalTipsCents,
        tipThreshold: thresholdCents,
        transferCount: 0,
        rarity: 'common' as const,
      }
    }
  },
})

// Get NFT details with transfer history
export const getNFTDetails = query({
  args: {
    nftId: v.id('articleNFTs'),
  },
  handler: async (ctx, args) => {
    const nft = await ctx.db.get(args.nftId)
    if (!nft) return null

    const [owner, minter, article] = await Promise.all([
      ctx.db.get(nft.currentOwner),
      ctx.db.get(nft.mintedBy),
      ctx.db.get(nft.articleId),
    ])

    // Get transfer history
    const transfers = await ctx.db
      .query('nftTransfers')
      .withIndex('by_nft', (q) => q.eq('nftId', args.nftId))
      .collect()

    // Enrich transfers with user data
    const enrichedTransfers = await Promise.all(
      transfers.map(async (transfer) => {
        const [from, to] = await Promise.all([
          enrichWithUser(ctx, transfer.fromUserId),
          enrichWithUser(ctx, transfer.toUserId),
        ])

        return {
          ...transfer,
          from,
          to,
        }
      })
    )

    return {
      ...nft,
      owner: owner
        ? {
            id: owner._id,
            name: owner.name,
            username: owner.username,
            avatar: owner.avatar,
            stellarAddress: owner.stellarAddress,
          }
        : null,
      minter: minter
        ? {
            id: minter._id,
            name: minter.name,
            username: minter.username,
            avatar: minter.avatar,
          }
        : null,
      article: article
        ? {
            id: article._id,
            title: article.title,
            slug: article.slug,
            excerpt: article.excerpt,
            coverImage: article.coverImage,
            authorUsername: article.authorUsername,
          }
        : null,
      transferHistory: enrichedTransfers,
    }
  },
})

// Mint NFT for article
export const mintNFT = mutation({
  args: {
    articleId: v.id('articles'),
    tipThreshold: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    const article = await ctx.db.get(args.articleId)
    if (!article) throw new Error('Article not found')
    if (article.authorId !== userId)
      throw new Error('Only the author can mint NFT for this article')

    // Check if NFT already exists for this article
    const existingNft = await ctx.db
      .query('articleNFTs')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .first()

    if (existingNft) {
      throw new Error('NFT already minted for this article')
    }

    const now = Date.now()

    // Generate NFT data
    const tokenId = `QUILL-${crypto.randomUUID()}`
    const metadataUrl = `https://quilltip.me/api/nft/${tokenId}`

    // Get total tips for the article
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .collect()

    const totalTipsUsd = tips.reduce((sum, tip) => sum + tip.amountUsd, 0)
    const totalTipsCents = Math.round(totalTipsUsd * 100)

    // Create NFT record
    const nftId = await ctx.db.insert('articleNFTs', {
      articleId: args.articleId,
      tokenId,
      contractAddress: '', // Will be set when deployed to Stellar
      metadataUrl,
      mintedBy: userId,
      currentOwner: userId,
      tipThreshold: args.tipThreshold || 1000, // Default $10 threshold
      totalTipsAtMint: totalTipsCents,
      mintedAt: now,
      updatedAt: now,
    })

    // Update article with NFT reference
    await ctx.db.patch(args.articleId, {
      hasNft: true,
      nftId,
      updatedAt: now,
    })

    // Update user NFT counts
    await ctx.db.patch(userId, {
      nftsCreated: (user.nftsCreated || 0) + 1,
      nftsOwned: (user.nftsOwned || 0) + 1,
      updatedAt: now,
    })

    return nftId
  },
})

// Transfer NFT
export const transferNFT = mutation({
  args: {
    nftId: v.id('articleNFTs'),
    toUsername: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const nft = await ctx.db.get(args.nftId)
    if (!nft) throw new Error('NFT not found')
    if (nft.currentOwner !== userId) throw new Error("You don't own this NFT")

    // Find recipient
    const recipient = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', args.toUsername))
      .first()

    if (!recipient) throw new Error('Recipient not found')
    if (recipient._id === userId) throw new Error('Cannot transfer to yourself')

    const fromUser = await ctx.db.get(userId)
    if (!fromUser) throw new Error('User not found')

    const now = Date.now()

    // Create transfer record
    const transferId = await ctx.db.insert('nftTransfers', {
      nftId: args.nftId,
      fromUserId: userId,
      toUserId: recipient._id,
      transactionId: `pending_transfer_${args.nftId}`,
      transferredAt: now,
    })

    // Update NFT ownership
    await ctx.db.patch(args.nftId, {
      currentOwner: recipient._id,
      updatedAt: now,
    })

    // Update user NFT counts
    await ctx.db.patch(userId, {
      nftsOwned: Math.max(0, (fromUser.nftsOwned || 0) - 1),
      updatedAt: now,
    })

    await ctx.db.patch(recipient._id, {
      nftsOwned: (recipient.nftsOwned || 0) + 1,
      updatedAt: now,
    })

    return transferId
  },
})

// Get user's minted NFTs
export const getUserMintedNFTs = query({
  args: {
    userId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const targetUserId = args.userId || (await getAuthUserId(ctx))
    if (!targetUserId) return []

    const nfts = await ctx.db
      .query('articleNFTs')
      .withIndex('by_minted_by', (q) => q.eq('mintedBy', targetUserId))
      .collect()

    // Enrich with article and current owner data
    const enrichedNfts = await Promise.all(
      nfts.map(async (nft) => {
        const [article, currentOwnerInfo] = await Promise.all([
          ctx.db.get(nft.articleId),
          enrichWithUser(ctx, nft.currentOwner),
        ])

        return {
          ...nft,
          article: article
            ? {
                id: article._id,
                title: article.title,
                slug: article.slug,
                authorUsername: article.authorUsername,
              }
            : null,
          currentOwnerInfo,
        }
      })
    )

    return enrichedNfts
  },
})

// Check if article has reached NFT minting threshold
export const checkMintingThreshold = query({
  args: {
    articleId: v.id('articles'),
    threshold: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId)
    if (!article) return { eligible: false, totalTips: 0, threshold: 0 }

    // Check if NFT already exists
    const existingNft = await ctx.db
      .query('articleNFTs')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .first()

    if (existingNft) {
      return {
        eligible: false,
        totalTips: article.totalTipsUsd || 0,
        threshold: args.threshold || 10,
        alreadyMinted: true,
      }
    }

    const totalTipsUsd = article.totalTipsUsd || 0
    const thresholdUsd = args.threshold || 10 // Default $10

    return {
      eligible: totalTipsUsd >= thresholdUsd,
      totalTips: totalTipsUsd,
      threshold: thresholdUsd,
      alreadyMinted: false,
    }
  },
})

// Generate NFT metadata for an article
export const generateNFTMetadata = query({
  args: {
    articleId: v.id('articles'),
    xlmPrice: v.number(), // Live XLM/USD price from client
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId)
    if (!article) return null

    // Get total tips for the article
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
      .collect()

    const totalTipsUsd = tips.reduce((sum, tip) => sum + tip.amountUsd, 0)
    const tipAmountInStroops = Math.floor(
      (totalTipsUsd / args.xlmPrice) * 10_000_000
    ) // Convert to stroops using live price

    // Generate NFT metadata following OpenSea/standard format
    return {
      name: `Quilltip Article: ${article.title}`,
      description:
        article.excerpt ||
        `An article by ${article.authorUsername} on Quilltip`,
      image: article.coverImage || 'https://quilltip.me/default-nft-image.png',
      external_url: `https://quilltip.me/${article.authorUsername}/${article.slug}`,
      attributes: {
        author: article.authorUsername,
        tipAmount: tipAmountInStroops,
        mintDate: new Date().toISOString(),
        articleSlug: article.slug,
      },
    }
  },
})
