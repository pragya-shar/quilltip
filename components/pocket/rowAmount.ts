import type { ActivityItem, Money } from '@/lib/pocket/types'

/**
 * The amount a row and its receipt show, chosen from the money layer's own
 * figures (nothing computed), so rows agree with the figures above them:
 * - a tip you sent: the tip as sent, or what was paid of it when it was paid
 *   only in part;
 * - a tip to you: your share, or the part of it that arrived when it was
 *   paid only in part. The money layer lists a tip to you only once it is
 *   accepted, so the share is known; if it is not, the row shows the tip.
 */
export function rowAmount(item: ActivityItem): Money {
  const reader = item.role === 'reader'
  const partly = item.status === 'not-paid' && item.paid.cents > 0
  if (reader) return partly ? item.paid : item.amount
  return partly ? item.paidNet : (item.net ?? item.amount)
}
