export const XLM_USD_TIP_RATE_STORAGE_KEY = 'quilltip:xlm_usd_tip_rate_v1'

export const DISPLAY_CACHE_TTL_MS = 4 * 60 * 60 * 1000

export type XlmUsdTipRateDisplayCache = {
  priceUsd: number
  clientFetchedAt: number
}

function isValidCacheEntry(value: unknown): value is XlmUsdTipRateDisplayCache {
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  return (
    typeof o.priceUsd === 'number' &&
    Number.isFinite(o.priceUsd) &&
    o.priceUsd > 0 &&
    typeof o.clientFetchedAt === 'number' &&
    Number.isFinite(o.clientFetchedAt)
  )
}

export function isDisplayCacheFresh(
  entry: XlmUsdTipRateDisplayCache,
  nowMs: number
): boolean {
  if (!Number.isFinite(nowMs)) return false
  const age = nowMs - entry.clientFetchedAt
  return age >= 0 && age < DISPLAY_CACHE_TTL_MS
}

export function readDisplayCache(): XlmUsdTipRateDisplayCache | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(XLM_USD_TIP_RATE_STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isValidCacheEntry(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

export function writeDisplayCache(priceUsd: number, clientFetchedAt: number): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return
    if (!Number.isFinite(clientFetchedAt)) return
    const payload: XlmUsdTipRateDisplayCache = { priceUsd, clientFetchedAt }
    localStorage.setItem(
      XLM_USD_TIP_RATE_STORAGE_KEY,
      JSON.stringify(payload)
    )
  } catch {
    // quota / private mode — display cache is optional
  }
}

export function formatUsdToXlmHint(priceUsd: number): string {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return ''
  const xlmPerUsd = 1 / priceUsd
  let digits: string
  if (xlmPerUsd >= 100) {
    digits = xlmPerUsd.toFixed(0)
  } else if (xlmPerUsd >= 1) {
    digits = xlmPerUsd.toFixed(2)
  } else {
    digits = xlmPerUsd.toFixed(4)
  }
  return `$1 \u2248 ${digits} XLM`
}
