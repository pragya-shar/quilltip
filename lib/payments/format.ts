/**
 * Amount formatting for the payment kit. Amounts arrive as decimal strings of
 * base units (stroops for native XLM), as Convex stores them. Nothing here
 * converts from cents or floats: the kit shows chain values only.
 */
import { formatUsd, formatXlmFromStroops } from '@/lib/copy/network-status'

const BASE_UNITS = /^\d+$/

/** True for a non-negative integer string of base units. */
export function isBaseUnits(value: string): boolean {
  return BASE_UNITS.test(value)
}

/**
 * "12.5 XLM" from "125000000". Full stroop precision by default, so a split
 * of 0.0000039 XLM is never shown as 0. Invalid input renders as a dash
 * rather than a wrong number.
 */
export function formatXlm(stroops: string, maxDecimals = 7): string {
  return isBaseUnits(stroops) ? formatXlmFromStroops(stroops, maxDecimals) : '–'
}

/**
 * "$0.50" from 50, `under-a-cent` for a fraction of a cent. `null` when no
 * quote is available, so the caller shows nothing rather than "$0.00".
 */
export function formatCentsQuote(
  cents: number | null | undefined
): string | 'under-a-cent' | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return null
  }
  if (cents <= 0) return null
  if (cents < 1) return 'under-a-cent'
  return formatUsd(Math.round(cents) / 100)
}

/**
 * "GBZX…MADI" for a Stellar address: the first and last four characters,
 * which wallets show too. Short values pass through.
 */
export function shortAddress(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : address
}

/** Testnet ledgers close about every 5 seconds. */
export const LEDGER_SECONDS = 5

/**
 * When a future ledger (for example `withdrawUnlockLedger` or a key's
 * `validUntilLedger`) is expected to close, from the latest ledger and its
 * close time. An estimate: ledger times vary, so the copy says "around".
 */
export function estimateLedgerTime(
  ledger: number,
  latest: { sequence: number; closedAt: number }
): Date {
  const ahead = Math.max(0, ledger - latest.sequence)
  return new Date(latest.closedAt + ahead * LEDGER_SECONDS * 1000)
}

/** "Saturday 30 November" in the reader's locale. */
export function formatDay(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)
}

/** Fee in basis points of the Core contract (`FEE_BPS`, 2.5%). */
export const CORE_FEE_BPS = BigInt(250)
const BPS_DENOMINATOR = BigInt(10_000)

/**
 * The Core split of one tip, mirroring the contract: the fee rounds down and
 * the writer side gets the remainder (I-1). For an estimate only: render it
 * with `AmountSummary estimate`, and replace it with the prepare response
 * or the `Tipped` event values once they exist.
 */
export function coreTipSplit(gross: string): {
  gross: string
  writer: string
  fee: string
} | null {
  if (!isBaseUnits(gross)) return null
  const value = BigInt(gross)
  const fee = (value * CORE_FEE_BPS) / BPS_DENOMINATOR
  return {
    gross: value.toString(),
    writer: (value - fee).toString(),
    fee: fee.toString(),
  }
}

const EXPLORER_TX = 'https://stellar.expert/explorer/testnet/tx/'

/** Public explorer link for a testnet transaction hash. */
export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_TX}${encodeURIComponent(hash)}`
}
