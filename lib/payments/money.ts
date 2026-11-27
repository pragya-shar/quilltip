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

/**
 * "$4.20". The one rounding rule for a figure: fractions of a cent are
 * floored, once, at the figure. Totals are summed from exact shares (cents
 * on a 1/10,000-cent grid) and floored only when shown, so a displayed total
 * never exceeds what the writer can collect or the reader can spend.
 */
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

/**
 * An exact amount for a detail line, never floored: "48.75¢" below a
 * dollar, "$4.875" from a dollar up. Cents carry at most 1/10,000 of a cent.
 */
export function formatExactCents(cents: Cents): string {
  const tenThousandths = Math.round(Math.max(0, cents) * 10_000)
  const whole = Math.floor(tenThousandths / 10_000)
  const part = String(tenThousandths % 10_000)
    .padStart(4, '0')
    .replace(/0+$/, '')
  if (whole < 100) return `${whole}${part ? `.${part}` : ''}¢`
  const dollars = Math.floor(whole / 100)
  const fraction = `${String(whole % 100).padStart(2, '0')}${part ? String(tenThousandths % 10_000).padStart(4, '0') : ''}`
  return `$${dollars.toLocaleString('en-US')}.${fraction.replace(/(\d{2})(\d*?)0*$/, '$1$2')}`
}

export function money(cents: Cents): Money {
  return { cents, display: formatMoney(cents) }
}

/**
 * A ready-to-collect figure: its token amount and its cents come from the
 * same tips and claims, so a positive token amount below one cent reads
 * "<$0.01", never "$0.00". Allowed only for the ready figure and its rows;
 * never on a tip button or a receipt, whose cents are exact.
 */
export function readyMoney(cents: Cents, baseUnits: string): Money {
  if (BigInt(baseUnits || '0') > BigInt(0) && Math.floor(cents + 1e-9) < 1)
    return { cents, display: '<$0.01' }
  return money(cents)
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
