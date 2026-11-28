/**
 * What a quick tip of a chosen amount would meet at prepare, from the limits
 * `tabs.getMyTab` returns (`tipLimits`). The tip dialog uses it to offer no
 * amount above the tab tip maximum and to explain any other limit before the
 * reader sends, so an expected refusal never reaches Convex. Convex still
 * decides on prepare.
 */
import type { MyTab } from './types'

export type TabTipLimits = NonNullable<MyTab['tipLimits']>

const STROOPS_PER_XLM = 10_000_000
const ZERO = BigInt(0)

/**
 * Base units for `cents` at `priceUsd` per XLM, rounded down. The same
 * arithmetic as `centsToStroops` in convex/lib/chain/tabLedger.ts, so the
 * client and prepare agree to the stroop.
 */
export function tabTipStroops(cents: number, priceUsd: number): bigint {
  return BigInt(Math.floor((cents * STROOPS_PER_XLM) / (priceUsd * 100)))
}

/** `YYYY-MM-DD` (UTC) of a time, as Convex counts the daily limit. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * The limits as they stand at `now`: the price only while prepare would still
 * use it, and what is left of today's limit (a new UTC day starts at zero).
 */
export function tabTipLimitsAt(
  limits: TabTipLimits,
  now: number
): { priceUsd: number | null; tipMaxCents: number | null; dailyLeft: bigint } {
  const fresh =
    limits.priceUsd !== null &&
    limits.priceFetchedAt !== null &&
    now - limits.priceFetchedAt <= limits.priceMaxAgeMs
  const accepted =
    limits.acceptedDay === utcDay(now) ? BigInt(limits.acceptedToday) : ZERO
  const left = BigInt(limits.dailyLimit) - accepted
  return {
    priceUsd: fresh ? limits.priceUsd : null,
    tipMaxCents: fresh ? limits.tipMaxCents : null,
    dailyLeft: left > ZERO ? left : ZERO,
  }
}

/**
 * The next time `tabTipLimitsAt` gives another answer (the price turns stale,
 * or the UTC day ends), so a page left open can check again then.
 */
export function nextLimitsChange(limits: TabTipLimits, now: number): number {
  const midnight = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() + 1
  )
  const stale =
    limits.priceFetchedAt !== null
      ? limits.priceFetchedAt + limits.priceMaxAgeMs + 1
      : Infinity
  return Math.min(midnight, stale > now ? stale : Infinity)
}

/**
 * The tab tip maximum as the dialog states it: the limit in base units
 * (`TAB_TIP_MAX`) and the largest whole-cent amount within it at the cached
 * price (#676).
 */
export type TabTipMax = { cents: number; stroops: string }

export type TabTipAmountCheck =
  | { ok: true; amount: string }
  /** No fresh XLM price, so prepare would refuse every amount. */
  | { ok: false; reason: 'no-price' }
  | { ok: false; reason: 'below-minimum'; amount: string }
  /** Above `TAB_TIP_MAX` at this price; `maxCents` is the largest that fits. */
  | { ok: false; reason: 'above-max'; maxCents: number }
  | { ok: false; reason: 'daily-limit'; amount: string; left: string }
  | { ok: false; reason: 'balance'; amount: string; free: string }
  | { ok: false; reason: 'key-limit'; amount: string; left: string }

export type TabTipAmountInput = {
  cents: number
  limits: TabTipLimits
  /** Free tab balance in base units (`available`). */
  free: string
  /** This device's key, for its spend limit. */
  key?: { acceptedTotal: string; spendLimit: string } | null
  /** The time to check at (milliseconds). */
  now: number
}

/** The first prepare check `cents` would fail, in prepare's order. */
export function checkTabTipAmount(input: TabTipAmountInput): TabTipAmountCheck {
  const { cents, limits } = input
  const at = tabTipLimitsAt(limits, input.now)
  if (at.priceUsd === null || at.tipMaxCents === null) {
    return { ok: false, reason: 'no-price' }
  }
  const stroops = tabTipStroops(cents, at.priceUsd)
  const amount = stroops.toString()
  if (limits.minTip !== null && stroops < BigInt(limits.minTip)) {
    return { ok: false, reason: 'below-minimum', amount }
  }
  if (cents > at.tipMaxCents) {
    return { ok: false, reason: 'above-max', maxCents: at.tipMaxCents }
  }
  if (stroops > at.dailyLeft) {
    return {
      ok: false,
      reason: 'daily-limit',
      amount,
      left: at.dailyLeft.toString(),
    }
  }
  if (stroops > BigInt(input.free)) {
    return { ok: false, reason: 'balance', amount, free: input.free }
  }
  if (input.key) {
    const left = BigInt(input.key.spendLimit) - BigInt(input.key.acceptedTotal)
    if (stroops > left) {
      return {
        ok: false,
        reason: 'key-limit',
        amount,
        left: (left > ZERO ? left : ZERO).toString(),
      }
    }
  }
  return { ok: true, amount }
}

/** Steps a smaller preset may take, in US cents. */
const PRESET_STEPS = [5, 10, 25, 50, 100, 200, 500, 1_000, 2_000] as const

/**
 * The dialog's preset amounts with a quick tip on offer: `base` when every
 * preset fits under `maxCents`, otherwise the same number of presets whose
 * largest is the maximum (rounded down to 5 cents from 20 cents up) and the
 * rest the largest smaller steps. Every preset stays at or above `minCents`
 * and at or below `maxCents`. Null when no amount fits at all (`maxCents`
 * below `minCents`): the tab can send nothing, so it explains every amount
 * and the dialog keeps the wallet's presets.
 */
export function tabTipPresets(
  base: readonly number[],
  maxCents: number,
  minCents = 1
): number[] | null {
  const floor = Math.max(minCents, 1)
  if (maxCents < floor) return null
  if (base.every((c) => c <= maxCents && c >= floor)) return [...base]
  // The maximum rounded down to 5 cents, unless that falls below the minimum.
  const rounded = maxCents >= 20 ? maxCents - (maxCents % 5) : maxCents
  const top = rounded >= floor ? rounded : maxCents
  const smaller = [...new Set([...base, ...PRESET_STEPS])]
    .filter((c) => c < top && c >= minCents)
    .sort((a, b) => b - a)
  return [top, ...smaller.slice(0, base.length - 1)].sort((a, b) => a - b)
}
