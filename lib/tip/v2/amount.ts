/**
 * Tip amounts in the v2 tip form. The reader chooses US cents; the server
 * converts them to base units with its cached price when it prepares the tip
 * (`tipsV2.prepare*`). Before that, the XLM figure is an estimate.
 */
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from '@/lib/constants'

/** Preset amounts in cents. */
export const TIP_PRESET_CENTS = [100, 200, 500] as const

const STROOPS_PER_XLM = 10_000_000

/** "$1", "$1.50", "$0.05". */
export function formatCents(cents: number): string {
  const whole = Math.floor(cents / 100)
  const rest = cents % 100
  return rest === 0
    ? `$${whole.toLocaleString('en-US')}`
    : `$${whole.toLocaleString('en-US')}.${String(rest).padStart(2, '0')}`
}

/**
 * Cents from a dollar string the reader typed: "1", "1.5", "1.50", "$2",
 * ".25". Null for anything else, including more than two decimals.
 */
export function parseDollars(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, '').replace(/,/g, '')
  if (!/^(\d{1,6})?(\.\d{0,2})?$/.test(trimmed) || trimmed === '.') return null
  if (trimmed === '') return null
  const [whole = '0', fraction = ''] = trimmed.split('.')
  return Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0') || '0')
}

export type AmountCheck =
  | { ok: true; cents: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'below' | 'above'; min: number }

/**
 * Checks a chosen amount against the app limits and the current minimum
 * from `getTipEligibility` (`minTipCents`, the smallest whole cent amount
 * whose base units reach Core's `min_tip`).
 */
export function checkAmount(
  cents: number | null,
  minTipCents: number | null | undefined,
  raw?: string
): AmountCheck {
  const min = Math.max(TIP_MIN_CENTS, minTipCents ?? TIP_MIN_CENTS)
  if (cents === null) {
    return {
      ok: false,
      reason: raw && raw.trim() ? 'invalid' : 'empty',
      min,
    }
  }
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: 'invalid', min }
  if (cents < min) return { ok: false, reason: 'below', min }
  if (cents > TIP_MAX_CENTS) return { ok: false, reason: 'above', min }
  return { ok: true, cents }
}

/**
 * The base units the server will prepare for `cents` at `priceUsd`, rounded
 * down: the same formula as `centsToBaseUnits` in
 * convex/lib/chain/tipPrepare.ts. For the estimate only.
 */
export function estimateBaseUnits(cents: number, priceUsd: number): string {
  if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) return '0'
  return BigInt(
    Math.floor((cents * STROOPS_PER_XLM) / (priceUsd * 100))
  ).toString()
}

export { TIP_MAX_CENTS, TIP_MIN_CENTS }
