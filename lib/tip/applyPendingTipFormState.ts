import type { PendingTipIntent } from '@/lib/tip/pendingTipIntent'

type AmountFields = Pick<PendingTipIntent, 'amountCents' | 'customAmount'>

export function applyPendingAmountFields(
  intent: AmountFields,
  setSelectedAmount: (value: number | null) => void,
  setCustomAmount: (value: string) => void
): void {
  // When resuming from login we may store both `amountCents` (validated) and
  // `customAmount` (what the user typed). Prefer custom input when present.
  if (intent.customAmount) {
    setCustomAmount(intent.customAmount)
    setSelectedAmount(null)
  } else if (intent.amountCents != null) {
    setSelectedAmount(intent.amountCents)
    setCustomAmount('')
  }
}
