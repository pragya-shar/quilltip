import { v } from 'convex/values'
import { verifiedTipFilter } from './lib/verifiedTips'
import { query } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { enrichWithUser } from './lib/enrich'
import { verifiedStellarAddress } from './lib/walletVerification'
import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { userForAddress } from './lib/chain/nftStore'

/**
 * Version label for NFT rows. v2 rows come from the article NFT contract;
 * every other row is a database-only v1 record (docs/architecture/v2/
 * 06-app-integration.md, section 6.9).
 */
function versionFields(nft: Doc<'articleNFTs'>) {
  const v2 = nft.contractVersion === 'v2'
  return {
    contractVersion: v2 ? ('v2' as const) : ('v1' as const),
    recordLabel: v2 ? null : ('v1 record' as const),
  }
}

/**
 * The Quilltip user who owns the row now. v2 ownership is by address: the
 * user whose verified address is `ownerAddress`. v1 rows use `currentOwner`.
 */
async function ownerUserId(
  ctx: QueryCtx,
  nft: Doc<'articleNFTs'>
): Promise<Id<'users'> | undefined> {
  if (nft.contractVersion !== 'v2') return nft.currentOwner
  return nft.ownerAddress ? userForAddress(ctx, nft.ownerAddress) : undefined
}

/** v1 rows owned through `currentOwner` plus v2 rows owned by address. */
async function rowsOwnedBy(
  ctx: QueryCtx,
  userId: Id<'users'>
): Promise<Doc<'articleNFTs'>[]> {
  const [cached, user] = await Promise.all([
    ctx.db
      .query('articleNFTs')
      .withIndex('by_current_owner', (q) => q.eq('currentOwner', userId))
      .collect(),
    ctx.db.get(userId),
  ])
  const address = verifiedStellarAddress(user)
  const v2 = address
    ? await ctx.db
        .query('articleNFTs')
        .withIndex('by_owner_address', (q) => q.eq('ownerAddress', address))
        .collect()
    : []
  // A v2 row's `currentOwner` is a cache from event time; the address decides.
  return [
    ...cached.filter((nft) => nft.contractVersion !== 'v2'),
    ...v2.filter((nft) => nft.contractVersion === 'v2'),
  ]
}

// Get NFTs by owner
export const getNFTsByOwner = query({
  args: {
    ownerId: v.optional(v.id('users')),
  },
  handler: async (ctx, args) => {
    const targetOwnerId = args.ownerId || (await getAuthUserId(ctx))
    if (!targetOwnerId) return []

    const nfts = await rowsOwnedBy(ctx, targetOwnerId)

    // Enrich with article data
    const enrichedNfts = await Promise.all(
      nfts.map(async (nft) => {
        const [article, minter] = await Promise.all([
          ctx.db.get(nft.articleId),
          enrichWithUser(ctx, nft.mintedBy),
        ])

        return {
          ...nft,
          ...versionFields(nft),
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

export const getNFTsByOwnerPaginated = query({
  args: {
    ownerId: v.id('users'),
    page: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = Math.max(args.page ?? 1, 1)
    const limit = Math.min(Math.max(args.limit ?? 9, 1), 50)
    const offset = (page - 1) * limit

    const rows = await rowsOwnedBy(ctx, args.ownerId)

    rows.sort((a, b) => b.mintedAt - a.mintedAt)
    const total = rows.length
    const slice = rows.slice(offset, offset + limit)

    const nfts = await Promise.all(
      slice.map(async (nft) => {
        const [article, minter] = await Promise.all([
          ctx.db.get(nft.articleId),
          enrichWithUser(ctx, nft.mintedBy),
        ])

        return {
          ...nft,
          ...versionFields(nft),
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

    return {
      nfts,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    }
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

    // Get existing NFT if it exists. A v2 row wins over a v1 record.
    const rows = await ctx.db
      .query('articleNFTs')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .take(20)
    const nft =
      rows
        .filter((row) => row.contractVersion === 'v2')
        .sort((a, b) => b.mintedAt - a.mintedAt)[0] ??
      rows[0] ??
      null

    // Get total tips for the article
    const tips = await ctx.db
      .query('tips')
      .withIndex('by_article', (q) => q.eq('articleId', args.articleId))
      .filter(verifiedTipFilter)
      .collect()

    const totalTipsUsd = tips.reduce((sum, tip) => sum + tip.amountUsd, 0)
    const totalTipsCents = Math.round(totalTipsUsd * 100)
    const thresholdCents = 1000 // $10 threshold in cents

    if (nft) {
      // NFT exists - return full NFT data with status
      const ownerId = await ownerUserId(ctx, nft)
      const [owner, minter] = await Promise.all([
        ownerId ? ctx.db.get(ownerId) : null,
        nft.mintedBy ? ctx.db.get(nft.mintedBy) : null,
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
        ...versionFields(nft),
        // Add status fields
        isMinted: true as const,
        isEligible: true,
        totalTips: totalTipsCents,
        tipThreshold: thresholdCents,
        owner:
          (nft.contractVersion === 'v2' ? nft.ownerAddress : undefined) ||
          verifiedStellarAddress(owner) ||
          owner?.username ||
          'Unknown',
        mintedAt: new Date(nft.mintedAt).toISOString(),
        transferCount: transfers.length,
        rarity,
        ownerInfo: owner
          ? {
              id: owner._id,
              name: owner.name,
              username: owner.username,
              avatar: owner.avatar,
              stellarAddress: verifiedStellarAddress(owner),
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
          ownerUserId(ctx, nft).then((id) => enrichWithUser(ctx, id)),
        ])

        return {
          ...nft,
          ...versionFields(nft),
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

export const getUserMintedNFTsPaginated = query({
  args: {
    userId: v.id('users'),
    page: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = Math.max(args.page ?? 1, 1)
    const limit = Math.min(Math.max(args.limit ?? 9, 1), 50)
    const offset = (page - 1) * limit

    const rows = await ctx.db
      .query('articleNFTs')
      .withIndex('by_minted_by', (q) => q.eq('mintedBy', args.userId))
      .collect()

    rows.sort((a, b) => b.mintedAt - a.mintedAt)
    const total = rows.length
    const slice = rows.slice(offset, offset + limit)

    const nfts = await Promise.all(
      slice.map(async (nft) => {
        const [article, currentOwnerInfo] = await Promise.all([
          ctx.db.get(nft.articleId),
          ownerUserId(ctx, nft).then((id) => enrichWithUser(ctx, id)),
        ])

        return {
          ...nft,
          ...versionFields(nft),
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
          currentOwnerInfo,
        }
      })
    )

    return {
      nfts,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    }
  },
})
