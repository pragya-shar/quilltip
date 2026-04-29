/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

afterEach(() => {
  vi.unstubAllGlobals()
})

// Stub fetch so the refresh action's call to fetchXlmPriceUsd resolves
// without hitting the network. The first matching oracle wins, so a single
// successful CoinGecko response is enough to drive every test.
function stubCoinGeckoOk(priceUsd: number) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (typeof url === 'string' && url.includes('coingecko')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({ stellar: { usd: priceUsd } }),
      }
    }
    // Other oracles never reached when CoinGecko succeeds, but keep them
    // safe in case the priority order changes.
    return { status: 500, ok: false, json: async () => ({}) }
  })
}

function stubAllOraclesDown() {
  vi.stubGlobal('fetch', async () => ({
    status: 500,
    ok: false,
    json: async () => ({}),
  }))
}

describe('xlmPrice.getCachedXlmPrice', () => {
  it('returns null when the cache table is empty', async () => {
    const t = convexTest(schema, modules)
    const cached = await t.query(api.xlmPrice.getCachedXlmPrice, {})
    expect(cached).toBeNull()
  })

  it('returns the row after a successful refresh', async () => {
    const t = convexTest(schema, modules)
    stubCoinGeckoOk(0.42)

    const result = await t.action(internal.xlmPrice.refreshXlmPriceCache, {})
    expect(result.ok).toBe(true)
    expect(result.source).toBe('CoinGecko')

    const cached = await t.query(api.xlmPrice.getCachedXlmPrice, {})
    expect(cached).not.toBeNull()
    expect(cached?.priceUsd).toBe(0.42)
    expect(cached?.source).toBe('CoinGecko')
    expect(cached?.ageMs).toBeGreaterThanOrEqual(0)
    expect(cached?.ageMs).toBeLessThan(5_000)
  })

  it('returns null when the cached row is older than MAX_PRICE_AGE_MS', async () => {
    const t = convexTest(schema, modules)
    // Seed a row that's 31 minutes old — past the 30-minute staleness gate.
    await t.run(async (ctx) => {
      await ctx.db.insert('xlmPriceCache', {
        priceUsd: 0.5,
        source: 'CoinGecko',
        fetchedAt: Date.now() - 31 * 60 * 1000,
      })
    })

    const cached = await t.query(api.xlmPrice.getCachedXlmPrice, {})
    expect(cached).toBeNull()
  })
})

describe('xlmPrice.refreshXlmPriceCache', () => {
  it('inserts a row on first successful refresh', async () => {
    const t = convexTest(schema, modules)
    stubCoinGeckoOk(0.31)

    await t.action(internal.xlmPrice.refreshXlmPriceCache, {})

    const rows = await t.run(async (ctx) =>
      ctx.db.query('xlmPriceCache').collect()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.priceUsd).toBe(0.31)
    expect(rows[0]?.source).toBe('CoinGecko')
  })

  it('patches the existing row on subsequent refreshes (singleton table)', async () => {
    const t = convexTest(schema, modules)

    stubCoinGeckoOk(0.3)
    await t.action(internal.xlmPrice.refreshXlmPriceCache, {})
    stubCoinGeckoOk(0.4)
    await t.action(internal.xlmPrice.refreshXlmPriceCache, {})

    const rows = await t.run(async (ctx) =>
      ctx.db.query('xlmPriceCache').collect()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.priceUsd).toBe(0.4)
  })

  it('leaves the existing row alone when all oracles fail', async () => {
    const t = convexTest(schema, modules)

    // Seed a known-good row.
    stubCoinGeckoOk(0.25)
    await t.action(internal.xlmPrice.refreshXlmPriceCache, {})

    // Now simulate a total oracle outage on the next refresh tick.
    stubAllOraclesDown()
    const result = await t.action(internal.xlmPrice.refreshXlmPriceCache, {})
    expect(result.ok).toBe(false)

    const rows = await t.run(async (ctx) =>
      ctx.db.query('xlmPriceCache').collect()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.priceUsd).toBe(0.25) // unchanged — better stale-good than overwritten-bad
  })
})
