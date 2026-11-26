/**
 * Amount rules for the tab screens. Amounts are decimal strings of base units
 * (stroops for native XLM), as Convex and the Tab contract use them. Nothing
 * here rounds a chain value: user input is parsed exactly, and limits come
 * from the Tab contract's `config()` and the wallet's account entry.
 */

const ZERO = BigInt(0)
export const STROOPS_PER_XLM = BigInt(10_000_000)
const XLM_INPUT = /^(\d{1,12})(?:[.,](\d{0,7}))?$/

/**
 * "10.5" → "105000000". Accepts a comma as the decimal mark. Null for
 * anything that is not a non-negative amount with at most 7 decimals.
 */
export function parseXlm(input: string): string | null {
  const match = XLM_INPUT.exec(input.trim())
  if (!match) return null
  const whole = BigInt(match[1]!)
  const fraction = BigInt((match[2] ?? '').padEnd(7, '0') || '0')
  return (whole * STROOPS_PER_XLM + fraction).toString()
}

/** "105000000" → "10.5", for an input field. No grouping, no unit. */
export function stroopsToInput(stroops: string): string {
  const value = BigInt(stroops)
  const whole = value / STROOPS_PER_XLM
  const fraction = (value % STROOPS_PER_XLM)
    .toString()
    .padStart(7, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function xlm(n: number): string {
  return (BigInt(n) * STROOPS_PER_XLM).toString()
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

/**
 * The account fields that decide what a Stellar account can spend
 * (`AccountEntry`): the native balance, the reserve-bearing entries and the
 * selling liabilities. `baseReserve` comes from the latest ledger header.
 */
export type AccountReserveInput = {
  balance: string
  numSubEntries: number
  numSponsoring: number
  numSponsored: number
  sellingLiabilities: string
  baseReserve: string
}

/**
 * Balance minus the minimum balance `(2 + subentries + sponsoring −
 * sponsored) × base reserve` and selling liabilities, never below zero.
 */
export function walletFundsFromAccount(input: AccountReserveInput): {
  balance: string
  reserve: string
  spendable: string
} {
  const entries = BigInt(
    Math.max(
      0,
      2 + input.numSubEntries + input.numSponsoring - input.numSponsored
    )
  )
  const reserve =
    entries * BigInt(input.baseReserve) + BigInt(input.sellingLiabilities)
  const balance = BigInt(input.balance)
  const spendable = balance > reserve ? balance - reserve : ZERO
  return {
    balance: balance.toString(),
    reserve: reserve.toString(),
    spendable: spendable.toString(),
  }
}

export type DepositProblem =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'below-minimum'; minimum: string }
  /** The Tab contract's `max_balance` would be exceeded. */
  | { kind: 'above-cap'; room: string }
  /** More than the wallet can spend after its reserve. */
  | { kind: 'above-spendable'; spendable: string }

/**
 * Checks a deposit before the wallet is asked, with the same bounds the Tab
 * contract enforces (`BelowMinimumDeposit`, `BalanceCapExceeded`), plus the
 * wallet's spendable balance. Unknown limits are not checked here; the
 * simulation still refuses them.
 */
export function checkDeposit(input: {
  amount: string | null
  tabBalance: string
  limits: { minDeposit: string; maxBalance: string } | null
  spendable: string | null
}): DepositProblem | null {
  if (input.amount === null) return { kind: 'invalid' }
  const amount = BigInt(input.amount)
  if (amount === ZERO) return { kind: 'empty' }
  if (input.limits) {
    const minimum = BigInt(input.limits.minDeposit)
    if (amount < minimum) {
      return { kind: 'below-minimum', minimum: minimum.toString() }
    }
    const room = BigInt(input.limits.maxBalance) - BigInt(input.tabBalance)
    if (amount > room) {
      return { kind: 'above-cap', room: (room > ZERO ? room : ZERO).toString() }
    }
  }
  if (input.spendable !== null && amount > BigInt(input.spendable)) {
    return { kind: 'above-spendable', spendable: input.spendable }
  }
  return null
}

/** The largest deposit that passes `checkDeposit`, or null when unknown. */
export function maxDeposit(input: {
  tabBalance: string
  limits: { maxBalance: string } | null
  spendable: string | null
}): string | null {
  const bounds: bigint[] = []
  if (input.limits) {
    const room = BigInt(input.limits.maxBalance) - BigInt(input.tabBalance)
    bounds.push(room > ZERO ? room : ZERO)
  }
  if (input.spendable !== null) bounds.push(BigInt(input.spendable))
  if (bounds.length === 0) return null
  return bounds.reduce((a, b) => minBig(a, b)).toString()
}

/** `a + b` on base-unit strings. */
export function addUnits(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString()
}

/** `a − b`, never below zero. */
export function subtractUnits(a: string, b: string): string {
  const out = BigInt(a) - BigInt(b)
  return (out > ZERO ? out : ZERO).toString()
}

export function isPositive(units: string | null | undefined): boolean {
  return !!units && /^\d+$/.test(units) && BigInt(units) > ZERO
}
