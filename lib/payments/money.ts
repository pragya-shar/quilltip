/**
 * Dollars on screen, and the conversions the optimistic balance needs.
 *
 * Exact or approximate: a dollar figure stored at tip time (the amount on
 * the tip button, the receipt, a row's tip amount, the writer's per-tip
 * amounts and their sums) is exact and shown as "$1.00". A dollar figure
 * converted from the token at today's price (the reader's spendable
 * balance) is an estimate and shown with "≈" (`approxMoney`). The
 * conversions repeat the server's arithmetic exactly (`centsToStroops` in
 * `convex/lib/chain/tabLedger.ts`, `centsFromBaseUnits` in
 * `convex/lib/moneyViews.ts`), so the figure shown at the tap is the figure
 * the server shows after acceptance.
 */
import type { Cents, Money } from './types'

const STROOPS_PER_XLM = 10_000_000

/** "$4.20". Fractions of a cent are floored: a figure never shows more. */
export function formatMoney(cents: Cents): string {
  const whole = Math.max(0, Math.floor(cents + 1e-9))
  const dollars = Math.floor(whole / 100)
  const rest = String(whole % 100).padStart(2, '0')
  return `$${dollars.toLocaleString('en-US')}.${rest}`
}

/** "$1" for whole dollars (button labels), else "$1.50". */
export function formatShort(cents: Cents): string {
  return cents % 100 === 0
    ? `$${(cents / 100).toLocaleString('en-US')}`
    : formatMoney(cents)
}

export function money(cents: Cents): Money {
  return { cents, display: formatMoney(cents) }
}

/** A figure converted from the token at today's price: "≈ $17.28". */
export function approxMoney(cents: Cents): Money {
  return { cents, display: `≈ ${formatMoney(cents)}` }
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
