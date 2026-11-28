/**
 * The figures a reader consents to, read from the prepared request: the
 * last moment tips are accepted under the new approval (one day before its
 * end on the network), and its cap in XLM with the dollar estimate beside
 * it. Never "7 days" or "a week": the date and the time.
 */
import { estimateLedgerTime } from '@/lib/payments/format'
import { baseUnitsToCents } from '@/lib/payments/money'
import { acceptsUntilLedger } from '@/lib/tab-ui/key-plan'
import type { LedgerClock } from './services'
import { capWords, formatUntil } from './words'

export function consentFigures(
  key: { validUntil: number; spendLimit: string },
  clock: LedgerClock,
  priceUsd: number | null,
  timeZone?: string
): { until: string; cap: string } {
  const until = formatUntil(
    estimateLedgerTime(acceptsUntilLedger(key.validUntil), clock),
    timeZone
  )
  const capCents =
    priceUsd && priceUsd > 0
      ? baseUnitsToCents(BigInt(key.spendLimit), priceUsd)
      : null
  return { until, cap: capWords(key.spendLimit, capCents) }
}

/** When an approval on the balance stops accepting tips. */
export function keyUntilDate(
  validUntilLedger: number,
  clock: LedgerClock | null
): Date | null {
  return clock
    ? estimateLedgerTime(acceptsUntilLedger(validUntilLedger), clock)
    : null
}

/** When an approval on the balance stops accepting tips, as a date. */
export function keyUntil(
  validUntilLedger: number,
  clock: LedgerClock | null,
  timeZone?: string
): string | null {
  if (!clock) return null
  return formatUntil(
    estimateLedgerTime(acceptsUntilLedger(validUntilLedger), clock),
    timeZone
  )
}
