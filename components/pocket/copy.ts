import type { ActivityStatus } from '@/system/components/ActivityRow'
import type { ActivityItem } from './types'

/**
 * The Pocket's words. Second person, plain, no jargon. A tip is final once
 * the server accepted it; "On its way" means accepted and not yet arrived.
 * "You were not charged" is said only when nothing of the tip was paid.
 */

export type RowWords = {
  /** How the row draws (ActivityRow): sending, pending, done or failed. */
  status: ActivityStatus
  /** The short words on the row. Empty for a tip that simply arrived. */
  short: string
  /** The sentence on the receipt. */
  long: string
}

const paidInPart = (item: ActivityItem) => item.paid.cents > 0

export function rowWords(item: ActivityItem): RowWords {
  const reader = item.role === 'reader'
  switch (item.status) {
    case 'sending':
      return {
        status: 'sending',
        short: 'Sending',
        long: 'Sending. Nothing is final until it is accepted.',
      }
    case 'sent':
      return item.lagging
        ? {
            status: 'pending',
            short: 'On its way, slower than usual',
            long: reader
              ? 'Sent and final. It is taking longer than usual to reach the writer, and stays on its way until it does.'
              : 'Accepted. It is taking longer than usual to arrive, and stays on its way until it does.',
          }
        : {
            status: 'pending',
            short: 'On its way',
            long: reader
              ? 'Sent and final. It is on its way to the writer.'
              : 'Accepted and on its way to your earnings.',
          }
    case 'on-chain':
      return {
        status: 'done',
        short: '',
        long: reader
          ? 'Sent and final. It reached the writer.'
          : 'Arrived in your earnings.',
      }
    case 'not-paid': {
      const waiting = item.reason === 'shortfall'
      if (paidInPart(item))
        return waiting
          ? {
              status: 'pending',
              short: 'Paid in part, the rest is waiting',
              long: reader
                ? 'Part of this tip reached the writer. The rest waits on your balance: add money and it goes through.'
                : "Part of this tip arrived. The rest is waiting on the reader's balance.",
            }
          : {
              status: 'done',
              short: 'Paid in part',
              long: reader
                ? 'Part of this tip reached the writer. The rest did not go and is back in your balance.'
                : 'Part of this tip arrived. The rest did not complete.',
            }
      if (waiting)
        return {
          status: 'pending',
          short: reader ? 'On hold until you add money' : 'On hold',
          long: reader
            ? 'Your balance was short when this was paid out. Add money and it goes through.'
            : "On hold: the reader's balance was short when it was paid out. It arrives if they add money.",
        }
      return {
        status: 'failed',
        short: reader
          ? 'Did not complete. You were not charged.'
          : 'Did not complete',
        long: reader
          ? 'This tip did not complete. You were not charged.'
          : 'This tip did not complete. The reader was not charged.',
      }
    }
  }
}

/** "3 tips", "1 tip" (D13): a count of tips says tips. */
export function tipsCount(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'tip' : 'tips'}`
}

/** "Just now", "4 min ago", "2 h ago", or a date. */
export function whenShort(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 45) return 'Just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/** "just now", "2 minutes ago", "3 hours ago": how old figures are. */
export function ago(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  return `${whenLong(at)}`
}

/** "28 Nov 2026, 9:38 am", for a receipt. */
export function whenLong(at: number): string {
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/** The public record of a settled tip, on the testnet explorer. */
export const recordHref = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`
