import type { PendingTipIntent } from '@/lib/tip/pendingTipIntent'

type AmountFields = Pick<PendingTipIntent, 'amountCents' | 'customAmount'>

export function applyPendingAmountFields(
  intent: AmountFields,
  setSelectedAmount: (value: number | null) => void,
  setCustomAmount: (value: string) => void
): void {
  if (intent.amountCents != null) {
    setSelectedAmount(intent.amountCents)
    setCustomAmount('')
  } else if (intent.customAmount) {
    setCustomAmount(intent.customAmount)
    setSelectedAmount(null)
  }
}
