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
 * "$0.50" from 50, "under $0.01" for a fraction of a cent. `null` when no
 * quote is available, so the caller shows nothing rather than "$0.00".
 */
export function formatCentsQuote(cents: number | null | undefined) {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) {
    return null
  }
  if (cents <= 0) return null
  if (cents < 1) return 'under $0.01'
  return formatUsd(Math.round(cents) / 100)
}

/** Fee in basis points of the Core contract (`FEE_BPS`, 2.5%). */
export const CORE_FEE_BPS = BigInt(250)
const BPS_DENOMINATOR = BigInt(10_000)

/**
 * The Core split of one tip, mirroring the contract: the fee rounds down and
 * the writer side gets the remainder (I-1). Use it only for a preview before
 * the server returns its expected values; after confirmation show the
 * amounts from the `Tipped` event.
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
