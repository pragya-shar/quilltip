/**
 * Server-side XLM/USD price oracle used by tip verification to cross-check
 * that a tip's claimed USD amount is consistent with what was actually paid
 * on-chain. Mirrors the oracle list the client uses in lib/stellar/client.ts;
 * kept server-side only because Convex's deployment bundle is convex/.
 *
 * Takes an injected fetch so it is unit testable without the network. Returns
 * a structured result — caller decides whether to treat an outage as
 * transient (retry) or fatal.
 */

export type XlmPriceResult =
  | { ok: true; priceUsd: number; source: string }
  | { ok: false; reason: 'all_oracles_failed' }

type MinimalFetch = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<MinimalResponse>

type MinimalResponse = {
  status: number
  ok: boolean
  json: () => Promise<unknown>
}

const MAX_REASONABLE_PRICE_USD = 100

type Oracle = {
  name: string
  url: string
  parse: (data: unknown) => number | undefined
}

const ORACLES: readonly Oracle[] = [
  {
    name: 'CoinGecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
    parse: (data) => {
      if (typeof data !== 'object' || data === null) return undefined
      const stellar = (data as Record<string, unknown>).stellar
      if (typeof stellar !== 'object' || stellar === null) return undefined
      const usd = (stellar as Record<string, unknown>).usd
      return typeof usd === 'number' ? usd : undefined
    },
  },
  {
    name: 'CoinCap',
    url: 'https://api.coincap.io/v2/assets/stellar',
    parse: (data) => {
      if (typeof data !== 'object' || data === null) return undefined
      const d = (data as Record<string, unknown>).data
      if (typeof d !== 'object' || d === null) return undefined
      const priceUsd = (d as Record<string, unknown>).priceUsd
      if (typeof priceUsd !== 'string') return undefined
      const parsed = parseFloat(priceUsd)
      return Number.isFinite(parsed) ? parsed : undefined
    },
  },
  {
    name: 'Binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=XLMUSDT',
    parse: (data) => {
      if (typeof data !== 'object' || data === null) return undefined
      const price = (data as Record<string, unknown>).price
      if (typeof price !== 'string') return undefined
      const parsed = parseFloat(price)
      return Number.isFinite(parsed) ? parsed : undefined
    },
  },
  {
    name: 'Kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=XLMUSD',
    parse: (data) => {
      if (typeof data !== 'object' || data === null) return undefined
      const result = (data as Record<string, unknown>).result
      if (typeof result !== 'object' || result === null) return undefined
      const ticker =
        (result as Record<string, unknown>).XXLMZUSD ??
        (result as Record<string, unknown>).XLMUSD
      if (typeof ticker !== 'object' || ticker === null) return undefined
      const c = (ticker as Record<string, unknown>).c
      if (!Array.isArray(c)) return undefined
      const first = c[0]
      if (typeof first !== 'string') return undefined
      const parsed = parseFloat(first)
      return Number.isFinite(parsed) ? parsed : undefined
    },
  },
]

export async function fetchXlmPriceUsd(
  fetchImpl: MinimalFetch
): Promise<XlmPriceResult> {
  for (const oracle of ORACLES) {
    try {
      const res = await fetchImpl(oracle.url, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) continue
      const body = await res.json()
      const price = oracle.parse(body)
      if (
        typeof price === 'number' &&
        price > 0 &&
        price < MAX_REASONABLE_PRICE_USD
      ) {
        return { ok: true, priceUsd: price, source: oracle.name }
      }
    } catch {
      continue
    }
  }
  return { ok: false, reason: 'all_oracles_failed' }
}

export function xlmOracleUrls(): readonly string[] {
  return ORACLES.map((o) => o.url)
}
