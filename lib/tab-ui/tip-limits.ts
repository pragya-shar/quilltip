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

/**
 * Base units for `cents` at `priceUsd` per XLM, rounded down. The same
 * arithmetic as `centsToStroops` in convex/lib/chain/tabLedger.ts, so the
 * client and prepare agree to the stroop.
 */
export function tabTipStroops(cents: number, priceUsd: number): bigint {
  return BigInt(Math.floor((cents * STROOPS_PER_XLM) / (priceUsd * 100)))
}

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
}

/** The first prepare check `cents` would fail, in prepare's order. */
export function checkTabTipAmount(input: TabTipAmountInput): TabTipAmountCheck {
  const { cents, limits } = input
  if (limits.priceUsd === null || limits.tipMaxCents === null) {
    return { ok: false, reason: 'no-price' }
  }
  const stroops = tabTipStroops(cents, limits.priceUsd)
  const amount = stroops.toString()
  if (limits.minTip !== null && stroops < BigInt(limits.minTip)) {
    return { ok: false, reason: 'below-minimum', amount }
  }
  if (cents > limits.tipMaxCents) {
    return { ok: false, reason: 'above-max', maxCents: limits.tipMaxCents }
  }
  if (stroops > BigInt(limits.dailyLeft)) {
    return { ok: false, reason: 'daily-limit', amount, left: limits.dailyLeft }
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
        left: (left > BigInt(0) ? left : BigInt(0)).toString(),
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
 * rest the largest smaller steps. Every preset stays at or above `minCents`.
 * `base` comes back unchanged when no amount fits.
 */
export function tabTipPresets(
  base: readonly number[],
  maxCents: number,
  minCents = 1
): number[] {
  if (base.every((c) => c <= maxCents)) return [...base]
  const top = maxCents >= 20 ? maxCents - (maxCents % 5) : maxCents
  if (top < Math.max(minCents, 1)) return [...base]
  const smaller = [...new Set([...base, ...PRESET_STEPS])]
    .filter((c) => c < top && c >= minCents)
    .sort((a, b) => b - a)
  return [top, ...smaller.slice(0, base.length - 1)].sort((a, b) => a - b)
}
