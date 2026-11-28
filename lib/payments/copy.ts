/**
 * Words on the balance, tip and earnings screens. Never "tab", "voucher",
 * "settle", "session key", "contract" or base units; a count of tips says
 * "tips", never readers or supporters.
 */
import { formatMoney } from './money'
import type { ActivityItem } from './types'

/**
 * A row's label and detail. Settled balance tips are "Added to earnings";
 * "Paid to your wallet" is only for collected money. Details state exact
 * amounts (`formatMoney`).
 */
export function statusCopy(item: ActivityItem): {
  label: string
  detail: string | null
  tone: 'plain' | 'done' | 'danger'
} {
  const reader = item.role === 'reader'
  const short = (cents: number) => formatMoney(cents)
  switch (item.status) {
    case 'sending':
      return { label: 'Sending', detail: null, tone: 'plain' }
    case 'sent':
      return reader
        ? {
            label: 'Sent',
            detail: item.lagging
              ? 'Final. It is taking longer than usual to reach the writer.'
              : 'Final. It is on its way to the writer.',
            tone: 'plain',
          }
        : {
            label: item.lagging ? 'Taking longer' : 'On its way',
            detail: item.lagging
              ? 'Taking longer than usual. It stays On its way until it arrives.'
              : 'Recorded and on its way.',
            tone: 'plain',
          }
    case 'on-chain':
      return {
        label: 'Added to earnings',
        detail: reader
          ? "Added to the writer's earnings."
          : 'Added to your earnings, ready to withdraw.',
        tone: 'done',
      }
    case 'not-paid': {
      // Never say nothing moved unless nothing was paid for this tip.
      const paid = reader ? item.paid.cents : item.paidNet.cents
      const whole = reader ? item.amount.cents : (item.net?.cents ?? 0)
      const rest = Math.max(0, whole - paid)
      const final = item.reason !== 'shortfall'
      if (paid > 0)
        return reader
          ? {
              label: 'Paid in part',
              detail: final
                ? `${short(paid)} was paid. ${short(rest)} is back in your balance.`
                : `${short(paid)} was paid. ${short(rest)} waits on your balance; add money and it goes through.`,
              tone: 'danger',
            }
          : {
              label: 'Paid in part',
              detail: final
                ? `${short(paid)} arrived. The rest did not complete.`
                : `${short(paid)} arrived. ${short(rest)} is waiting on the reader's balance.`,
              tone: 'danger',
            }
      if (!final)
        return reader
          ? {
              // "On hold" is the internal name only; both sides read this.
              label: 'Waiting for balance',
              detail:
                'Your balance was short when this was paid out. Add money and it goes through.',
              tone: 'danger',
            }
          : {
              label: 'Waiting for balance',
              detail: "Waiting on the reader's balance.",
              tone: 'danger',
            }
      return reader
        ? {
            label: 'Did not complete',
            detail: `Did not complete. ${short(item.amount.cents)} is back in your balance.`,
            tone: 'danger',
          }
        : {
            label: 'Did not complete',
            detail: 'Did not complete. The reader was not charged.',
            tone: 'danger',
          }
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
