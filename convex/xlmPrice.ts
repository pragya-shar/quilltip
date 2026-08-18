import { v } from 'convex/values'
import { internalAction, internalMutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { fetchXlmPriceUsd } from './lib/xlmPrice'

// Past this age, the cached price is considered too stale to trust and the
// query returns null. Client falls back to the hard-coded rate. The cron
// runs every 5 minutes, so this only triggers if the cron has been failing
// for ~30+ min — a real outage signal worth surfacing rather than silently
// serving very old prices.
export const MAX_PRICE_AGE_MS = 30 * 60 * 1000

export type CachedXlmPrice = {
  priceUsd: number
  source: string
  fetchedAt: number
  ageMs: number
}

/**
 * Public query — read the latest cached XLM/USD price. Returns null if the
 * cache is empty (cold deploy, before first cron run) or stale beyond
 * MAX_PRICE_AGE_MS. Callers are expected to fall back to a hard-coded rate
 * in either case.
 *
 * Reading is cheap: indexed `.first()` over a singleton table. No fetch ever
 * happens in this codepath — fetches live in the refresh action below.
 */
export const getCachedXlmPrice = query({
  args: {},
  handler: async (ctx): Promise<CachedXlmPrice | null> => {
    const row = await ctx.db.query('xlmPriceCache').first()
    if (!row) return null
    const ageMs = Date.now() - row.fetchedAt
    if (ageMs > MAX_PRICE_AGE_MS) return null
    return {
      priceUsd: row.priceUsd,
      source: row.source,
      fetchedAt: row.fetchedAt,
      ageMs,
    }
  },
})

/**
 * Internal: write the latest fetched price to the singleton cache row.
 * Patches if a row already exists, inserts otherwise. Convex mutations are
 * transactional, so concurrent refresh actions are safe — last write wins.
 */
export const upsertXlmPriceCache = internalMutation({
  args: {
    priceUsd: v.number(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existing = await ctx.db.query('xlmPriceCache').first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        priceUsd: args.priceUsd,
        source: args.source,
        fetchedAt: now,
      })
    } else {
      await ctx.db.insert('xlmPriceCache', {
        priceUsd: args.priceUsd,
        source: args.source,
        fetchedAt: now,
      })
    }
  },
})

/**
 * Internal action — fetches the live XLM price from one of the public
 * oracles and updates the cache. Run on a 5-minute cron (see
 * convex/crons.ts). On total oracle failure we leave the existing cache
 * row alone rather than overwrite a known-good price with garbage; the
 * `MAX_PRICE_AGE_MS` check in the query is what eventually surfaces the
 * outage to clients.
 */
export const refreshXlmPriceCache = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; source?: string }> => {
    const result = await fetchXlmPriceUsd(fetch)
    if (!result.ok) {
      console.warn('[xlmPrice] all oracles failed, leaving cache unchanged', {
        reason: result.reason,
      })
      return { ok: false }
    }
    await ctx.runMutation(internal.xlmPrice.upsertXlmPriceCache, {
      priceUsd: result.priceUsd,
      source: result.source,
    })
    console.log('[xlmPrice] cache refreshed', {
      source: result.source,
      priceUsd: result.priceUsd,
    })
    return { ok: true, source: result.source }
  },
})
