/**
 * Words on the balance, tip and earnings screens (design copy deck, section
 * 9). Never "tab", "voucher", "settle", "session key", "contract" or base
 * units; a count of tips says "tips" (D13).
 */
import type { ActivityItem } from './types'

export function statusCopy(item: ActivityItem): {
  label: string
  detail: string | null
  tone: 'plain' | 'done' | 'danger'
} {
  const reader = item.role === 'reader'
  switch (item.status) {
    case 'sending':
      return { label: 'Sending', detail: null, tone: 'plain' }
    case 'sent':
      return reader
        ? {
            label: 'Sent',
            detail: 'Final. It is on its way to the writer.',
            tone: 'plain',
          }
        : {
            label: item.lagging ? 'On its way, taking longer' : 'On its way',
            detail: item.lagging
              ? 'Recorded and on its way. It is taking longer than usual. Nothing for you to do.'
              : 'Recorded and on its way.',
            tone: 'plain',
          }
    case 'on-chain':
      return {
        label: 'Paid',
        detail: reader
          ? 'Paid to the writer.'
          : 'Paid to you. Ready to collect, or already collected.',
        tone: 'done',
      }
    case 'not-paid':
      if (item.reason === 'shortfall')
        return reader
          ? {
              label: 'On hold',
              detail:
                'Your balance was short when this was paid out. Add money and it goes through.',
              tone: 'danger',
            }
          : {
              label: 'On hold',
              detail:
                "The reader's balance ran short. It is paid if they add money.",
              tone: 'danger',
            }
      return reader
        ? {
            label: 'Did not go through',
            detail: 'You were not charged. The money is back in your balance.',
            tone: 'danger',
          }
        : {
            label: 'Did not complete',
            detail: 'The reader was not charged.',
            tone: 'danger',
          }
  }
}

/** "3 tips", "1 tip". */
export function tipsCount(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'tip' : 'tips'}`
}

/** "Just now", "4 min ago", "2 h ago", or a date. */
export function whenCopy(at: number, now: number): string {
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

export const TX_LINK = (hash: string) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`
