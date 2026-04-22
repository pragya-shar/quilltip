/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { fetchXlmPriceUsd, xlmOracleUrls } from './xlmPrice'

type MockResponse = {
  status: number
  ok?: boolean
  body: unknown
}

function routingFetch(handlers: Record<string, MockResponse | 'throw'>) {
  return async (url: string) => {
    const match = Object.keys(handlers).find((k) => url.includes(k))
    if (!match) {
      throw new Error(`unexpected url: ${url}`)
    }
    const handler = handlers[match]
    if (handler === 'throw') throw new Error('network down')
    if (!handler) throw new Error('no handler')
    return {
      status: handler.status,
      ok: handler.ok ?? (handler.status >= 200 && handler.status < 300),
      json: async () => handler.body,
    }
  }
}

describe('fetchXlmPriceUsd', () => {
  it('returns the CoinGecko price when the first oracle succeeds', async () => {
    const fetchImpl = routingFetch({
      'api.coingecko.com': { status: 200, body: { stellar: { usd: 0.22 } } },
    })
    const result = await fetchXlmPriceUsd(fetchImpl)
    expect(result).toEqual({ ok: true, priceUsd: 0.22, source: 'CoinGecko' })
  })

  it('falls back to CoinCap when CoinGecko throws', async () => {
    const fetchImpl = routingFetch({
      'api.coingecko.com': 'throw',
      'api.coincap.io': {
        status: 200,
        body: { data: { priceUsd: '0.23' } },
      },
    })
    const result = await fetchXlmPriceUsd(fetchImpl)
    expect(result).toEqual({ ok: true, priceUsd: 0.23, source: 'CoinCap' })
  })

  it('falls back to Binance when the first two oracles fail', async () => {
    const fetchImpl = routingFetch({
      'api.coingecko.com': { status: 500, body: {} },
      'api.coincap.io': { status: 500, body: {} },
      'api.binance.com': { status: 200, body: { price: '0.24' } },
    })
    const result = await fetchXlmPriceUsd(fetchImpl)
    expect(result).toEqual({ ok: true, priceUsd: 0.24, source: 'Binance' })
  })

  it('falls back to Kraken as the final oracle', async () => {
    const fetchImpl = routingFetch({
      'api.coingecko.com': { status: 500, body: {} },
      'api.coincap.io': { status: 500, body: {} },
      'api.binance.com': { status: 500, body: {} },
      'api.kraken.com': {
        status: 200,
        body: { result: { XXLMZUSD: { c: ['0.25'] } } },
      },
    })
    const result = await fetchXlmPriceUsd(fetchImpl)
    expect(result).toEqual({ ok: true, priceUsd: 0.25, source: 'Kraken' })
  })

  it('returns all_oracles_failed when every source errors', async () => {
    const fetchImpl = routingFetch({
      'api.coingecko.com': 'throw',
      'api.coincap.io': 'throw',
      'api.binance.com': 'throw',
      'api.kraken.com': 'throw',
    })
    const result = await fetchXlmPriceUsd(fetchImpl)
    expect(result).toEqual({ ok: false, reason: 'all_oracles_failed' })
  })

  it('rejects obviously insane prices and falls through to the next oracle', async () => {
    const fetchImpl = routingFetch({
      'api.coingecko.com': { status: 200, body: { stellar: { usd: 10_000 } } },
      'api.coincap.io': { status: 200, body: { data: { priceUsd: '0.22' } } },
    })
    const result = await fetchXlmPriceUsd(fetchImpl)
    expect(result).toEqual({ ok: true, priceUsd: 0.22, source: 'CoinCap' })
  })

  it('rejects non-positive prices and falls through', async () => {
    const fetchImpl = routingFetch({
      'api.coingecko.com': { status: 200, body: { stellar: { usd: 0 } } },
      'api.coincap.io': { status: 200, body: { data: { priceUsd: '0.22' } } },
    })
    const result = await fetchXlmPriceUsd(fetchImpl)
    expect(result).toEqual({ ok: true, priceUsd: 0.22, source: 'CoinCap' })
  })

  it('rejects malformed oracle responses and falls through', async () => {
    const fetchImpl = routingFetch({
      'api.coingecko.com': { status: 200, body: { unexpected: 'shape' } },
      'api.coincap.io': { status: 200, body: { data: { priceUsd: '0.22' } } },
    })
    const result = await fetchXlmPriceUsd(fetchImpl)
    expect(result).toEqual({ ok: true, priceUsd: 0.22, source: 'CoinCap' })
  })

  it('exposes oracle URLs for wiring in consumer tests', () => {
    const urls = xlmOracleUrls()
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((u) => u.startsWith('https://'))).toBe(true)
  })
})
