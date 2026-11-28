/**
 * The writer's side of publishing. The Publish flow publishes first and turns
 * tips on as a separate step; `registrationState` tells the Publish sheet and
 * the tip context where that step stands.
 */
import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { query } from './_generated/server'
import { readChainEnv, type ChainEnv } from './lib/chain/env'
import { verifiedStellarAddress } from './lib/walletVerification'

/** Rows per article across contract deployments; one per deployment. */
const ROWS_PER_ARTICLE = 20

export type RegistrationState =
  /** Tips cannot be turned on on this deployment. */
  | { state: 'unavailable'; published: boolean }
  /** Not registered; `next` is the writer's next step to turn tips on. */
  | {
      state: 'not_registered'
      published: boolean
      next: 'publish' | 'verify_wallet' | 'turn_on' | 'retry'
    }
  /** A registration is prepared or submitted and not yet confirmed. */
  | { state: 'pending'; published: boolean }
  /**
   * Registered. `payoutOutdated`: the writer's verified wallet is no longer
   * the address tips pay, so tips stay off until the author change.
   */
  | { state: 'registered'; published: boolean; payoutOutdated: boolean }

function chainOrNull(): ChainEnv | null {
  try {
    return readChainEnv()
  } catch {
    // The network guard or an invalid contract setting: no tips here.
    return null
  }
}

/**
 * The article's tip registration state, for its author only (null for anyone
 * else). Holds no address, hash, key or transaction. Reads the article, the
 * author and at most `ROWS_PER_ARTICLE` registration rows.
 */
export const registrationState = query({
  args: { articleId: v.id('articles') },
  handler: async (ctx, args): Promise<RegistrationState | null> => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const article = await ctx.db.get(args.articleId)
    if (!article || article.authorId !== userId) return null
    const published = article.published

    const chain = chainOrNull()
    if (!chain || !chain.v2Enabled || !chain.coreContractId) {
      return { state: 'unavailable', published }
    }

    const rows = await ctx.db
      .query('chainArticles')
      .withIndex('by_article', (q) => q.eq('articleId', article._id))
      .take(ROWS_PER_ARTICLE)
    const row = rows.find((r) => r.chainEpoch === chain.chainEpoch) ?? null
    const user = await ctx.db.get(userId)
    const wallet = verifiedStellarAddress(user, chain.passphrase)

    if (row?.status === 'REGISTERED') {
      return {
        state: 'registered',
        published,
        payoutOutdated: wallet !== row.authorAddress,
      }
    }
    if (row?.status === 'PREPARED' || row?.status === 'SUBMITTED') {
      return { state: 'pending', published }
    }
    const next = !published
      ? 'publish'
      : !wallet
        ? 'verify_wallet'
        : row?.status === 'FAILED'
          ? 'retry'
          : 'turn_on'
    return { state: 'not_registered', published, next }
  },
})
