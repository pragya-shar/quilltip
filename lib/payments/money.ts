/**
 * Money text and the conversions the optimistic balance
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
 * `converted: false`. A converted figure is written to the cent, floored,
 * with "≈", because the balance is held in XLM and its dollar figure moves
 * with the price; how is one decision, `CONVERTED_STYLE`, which
 * every surface reads through `formatMoney`; views
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
 * How a converted figure is written: `approx` ("≈ $2.54": while the balance
 * is held in XLM its dollar figure is a conversion) or
 * `plain` ("$2.54"). Either way a converted figure has two decimals, never
 * six. The one place this is decided.
 */
export const CONVERTED_STYLE: 'plain' | 'approx' = 'approx'

export type MoneyFormat = {
  /** A row's direction: `minus` for a tip sent ("−$1.00"), `plus` for one
   * received ("+$1.95"). None by default. */
  sign?: 'minus' | 'plus'
  /** The figure is a conversion at today's price. */
  converted?: boolean
  /** How a converted figure is written; `CONVERTED_STYLE` by default. */
  convertedStyle?: 'plain' | 'approx'
  /** For the tip button and the amount choices: whole dollars without
   * ".00" ("$1", "$0.50", "$2.50"). Receipts and rows keep two decimals. */
  short?: boolean
}

const MINUS = '−'

/** "$4.20", "$0.0975": exact, two to six decimals. */
export function formatMoney(cents: Cents, format: MoneyFormat = {}): string {
  // A conversion is written to the cent, floored: never more than it buys.
  const value = format.converted
    ? Math.floor(Math.max(0, cents) + 1e-9)
    : Math.max(0, cents)
  const millionths = Math.round(value * 10_000)
  const dollars = Math.floor(millionths / 1_000_000)
  const fraction = String(millionths % 1_000_000)
    .padStart(6, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0')
  const sign =
    format.sign === 'minus' ? MINUS : format.sign === 'plus' ? '+' : ''
  const approx =
    format.converted && (format.convertedStyle ?? CONVERTED_STYLE) === 'approx'
  const decimals = format.short && fraction === '00' ? '' : `.${fraction}`
  return `${approx ? '≈ ' : ''}${sign}$${dollars.toLocaleString('en-US')}${decimals}`
}

/**
 * The spoken form, for a screen reader: "18 dollars 40", "9.75 cents"; a
 * converted figure reads to the cent with "about" in place of "≈" ("about
 * 18 dollars 40").
 */
export function spokenMoney(
  cents: Cents,
  format: Pick<MoneyFormat, 'converted'> = {}
): string {
  const value = format.converted
    ? Math.floor(Math.max(0, cents) + 1e-9)
    : Math.round(Math.max(0, cents) * 10_000) / 10_000
  const dollars = Math.floor(value / 100)
  const rest = Math.round((value - dollars * 100) * 10_000) / 10_000
  const words =
    dollars === 0
      ? `${rest} ${rest === 1 ? 'cent' : 'cents'}`
      : `${dollars.toLocaleString('en-US')} ${dollars === 1 ? 'dollar' : 'dollars'}${rest ? ` ${rest}` : ''}`
  return format.converted ? `about ${words}` : words
}

export function money(cents: Cents): Money {
  return {
    cents,
    display: formatMoney(cents),
    converted: false,
    spoken: spokenMoney(cents),
  }
}

/** A figure converted from a token amount at today's price. */
export function convertedMoney(cents: Cents): Money {
  return {
    cents,
    display: formatMoney(cents, { converted: true }),
    converted: true,
    spoken: spokenMoney(cents, { converted: true }),
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
