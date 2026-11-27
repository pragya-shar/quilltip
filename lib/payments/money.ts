/**
 * Money text (design rule N2) and the conversions the optimistic balance
 * needs.
 *
 * Exact always: two decimals, and more only when the amount has fractions
 * of a cent, up to six ("$1.00", "$1.95", "$0.0975", "$2.925",
 * "$0.04875"); trailing zeros after the second decimal are dropped; nothing
 * is rounded for display. Cents carry at most 1/10,000 of a cent, so six
 * decimals always suffice; an amount below that shows "$0.00", with its
 * exact token amount one tap away. "<$0.01" is never used on Quilltip's own
 * figures. A top figure is the sum of its rows.
 *
 * Converted figures. A figure converted from a token amount at today's
 * price (the reader's spendable balance) carries `converted: true`; one
 * stored at tip time (a tip, a share, the earnings figures) carries
 * `converted: false`. How a converted figure is written is one decision,
 * `CONVERTED_STYLE`, which every surface reads through `formatMoney`; views
 * never bake it into a string of their own.
 *
 * The conversions repeat the server's arithmetic exactly (`centsToStroops`
 * in `convex/lib/chain/tabLedger.ts`, `centsFromBaseUnits` in
 * `convex/lib/moneyViews.ts`), so the figure shown at the tap is the figure
 * the server shows after acceptance.
 */
import type { Cents, Money } from './types'

const STROOPS_PER_XLM = 10_000_000

/**
 * How a converted figure is written: `plain` ("$2.54", the design's rule N2
 * today) or `approx` ("≈ $2.54"). The one place this is decided.
 */
export const CONVERTED_STYLE: 'plain' | 'approx' = 'plain'

export type MoneyFormat = {
  /** A row's direction: `minus` for a tip sent ("−$1.00"), `plus` for one
   * received ("+$1.95"). None by default. */
  sign?: 'minus' | 'plus'
  /** The figure is a conversion at today's price. */
  converted?: boolean
  /** How a converted figure is written; `CONVERTED_STYLE` by default. */
  convertedStyle?: 'plain' | 'approx'
}

const MINUS = '−'

/** "$4.20", "$0.0975": exact, two to six decimals (N2). */
export function formatMoney(cents: Cents, format: MoneyFormat = {}): string {
  const millionths = Math.round(Math.max(0, cents) * 10_000)
  const dollars = Math.floor(millionths / 1_000_000)
  const fraction = String(millionths % 1_000_000)
    .padStart(6, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0')
  const sign =
    format.sign === 'minus' ? MINUS : format.sign === 'plus' ? '+' : ''
  const approx =
    format.converted && (format.convertedStyle ?? CONVERTED_STYLE) === 'approx'
  return `${approx ? '≈ ' : ''}${sign}$${dollars.toLocaleString('en-US')}.${fraction}`
}

/** "$1" for whole dollars (button labels), else exact ("$0.10"). */
export function formatShort(cents: Cents): string {
  return cents % 100 === 0
    ? `$${(cents / 100).toLocaleString('en-US')}`
    : formatMoney(cents)
}

/** A figure stored at tip time: exact, never a conversion. */
export function money(cents: Cents): Money {
  return { cents, display: formatMoney(cents), converted: false }
}

/** A figure converted from a token amount at today's price. */
export function convertedMoney(cents: Cents): Money {
  return {
    cents,
    display: formatMoney(cents, { converted: true }),
    converted: true,
  }
}

/** Base units for a cent amount at `priceUsd` per XLM, as prepare converts. */
export function centsToBaseUnits(cents: Cents, priceUsd: number): bigint {
  if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) return BigInt(0)
  return BigInt(Math.floor((cents * STROOPS_PER_XLM) / (priceUsd * 100)))
}

/** Cents a base-unit amount is worth at `priceUsd`, floored, as the server. */
export function baseUnitsToCents(base: bigint, priceUsd: number): Cents {
  if (base <= BigInt(0) || !(priceUsd > 0) || !Number.isFinite(priceUsd))
    return 0
  return Math.floor((Number(base) * priceUsd * 100) / STROOPS_PER_XLM)
}

/** "2.8571428 XLM": the exact token amount, trailing zeros removed. */
export function formatTokenAmount(base: string): string {
  const negative = base.startsWith('-')
  const digits = (negative ? base.slice(1) : base).padStart(8, '0')
  const whole = digits.slice(0, -7).replace(/^0+(?=\d)/, '')
  const fraction = digits.slice(-7).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''} XLM`
}
