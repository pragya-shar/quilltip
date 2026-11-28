/**
 * The amounts the Add money sheet offers, in dollars, from the Tab
 * contract's limits, the balance, what the wallet can spend and today's
 * price. An amount shows only when it can work on this request: no
 * greyed-out choice. Pure rules; base units are stroop strings.
 */
import { baseUnitsToCents, centsToBaseUnits } from '@/lib/payments/money'

/** The amounts offered first, in cents. */
export const SEGMENTS = [1000, 2000, 5000] as const

/**
 * What the wallet keeps back for the network fee when the amounts are
 * chosen (0.1 XLM). The exact fee comes from the prepared request and is
 * checked again before the wallet is asked.
 */
export const FEE_MARGIN_STROOPS = BigInt(1_000_000)

export type AmountInput = {
  /** One XLM in dollars, or null when no price is known. */
  priceUsd: number | null
  /** The balance on chain, in stroops. */
  balance: string
  limits: { minDeposit: string; maxBalance: string } | null
  /** What the wallet can spend after its reserve, or null when unknown. */
  spendable: string | null
  /** The tip the reader wanted, when the sheet opened from one. */
  needCents?: number | null
}

export type AmountOffer =
  | { kind: 'price-unknown' }
  /** The contract's limits could not be read yet. */
  | { kind: 'limits-unknown' }
  | { kind: 'full'; maxBalanceCents: number }
  | { kind: 'wallet-short'; spendableCents: number; spendable: string }
  | {
      kind: 'amounts'
      minCents: number
      maxCents: number
      segments: number[]
      /** A typed amount can go beyond the segments. */
      other: boolean
      /** The segment chosen first, or null for Other. */
      chosen: number | null
      /** Some segments are above what the wallet can spend. */
      walletLimited: boolean
    }

const ZERO = BigInt(0)

function ceilCents(stroops: bigint, price: number): number {
  const floor = baseUnitsToCents(stroops, price)
  return centsToBaseUnits(floor, price) >= stroops ? floor : floor + 1
}

export function amountOffer(input: AmountInput): AmountOffer {
  const price = input.priceUsd
  if (price === null || !(price > 0)) return { kind: 'price-unknown' }
  if (!input.limits) return { kind: 'limits-unknown' }
  const min = BigInt(input.limits.minDeposit)
  const maxBalance = BigInt(input.limits.maxBalance)
  const room = maxBalance - BigInt(input.balance)
  if (room < min)
    return {
      kind: 'full',
      maxBalanceCents: baseUnitsToCents(maxBalance, price),
    }
  const walletRoom =
    input.spendable === null
      ? null
      : BigInt(input.spendable) - FEE_MARGIN_STROOPS
  if (walletRoom !== null && walletRoom < min) {
    const spendable = input.spendable ?? '0'
    return {
      kind: 'wallet-short',
      spendable,
      spendableCents: baseUnitsToCents(
        BigInt(spendable) > ZERO ? BigInt(spendable) : ZERO,
        price
      ),
    }
  }
  const top = walletRoom !== null && walletRoom < room ? walletRoom : room
  const minCents = ceilCents(min, price)
  const maxCents = baseUnitsToCents(top, price)
  if (maxCents < minCents)
    return {
      kind: 'wallet-short',
      spendable: input.spendable ?? '0',
      spendableCents: baseUnitsToCents(BigInt(input.spendable ?? '0'), price),
    }
  const roomCents = baseUnitsToCents(room, price)
  const segments = SEGMENTS.filter((c) => c >= minCents && c <= maxCents)
  const need = input.needCents ?? null
  const chosen =
    (need !== null ? segments.find((c) => c >= need) : undefined) ??
    segments[0] ??
    null
  return {
    kind: 'amounts',
    minCents,
    maxCents,
    segments,
    other: maxCents > minCents,
    chosen,
    walletLimited: SEGMENTS.some((c) => c > maxCents && c <= roomCents),
  }
}

/**
 * A typed dollar amount ("12", "12.5", "$12.50") in cents, or null when it
 * is not an amount with at most two decimals.
 */
export function parseDollars(text: string): number | null {
  const match = /^\s*\$?\s*(\d{1,7})(?:[.,](\d{0,2}))?\s*$/.exec(text)
  if (!match) return null
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0')
  return cents > 0 ? cents : null
}

export type OtherProblem = 'empty' | 'below' | 'above' | null

export function checkOther(
  cents: number | null,
  offer: Extract<AmountOffer, { kind: 'amounts' }>
): OtherProblem {
  if (cents === null) return 'empty'
  if (cents < offer.minCents) return 'below'
  if (cents > offer.maxCents) return 'above'
  return null
}

/** The deposit in stroops for a dollar amount at today's price. */
export function depositStroops(cents: number, priceUsd: number): string {
  return centsToBaseUnits(cents, priceUsd).toString()
}
