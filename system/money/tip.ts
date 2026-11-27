import type { MoneyValue } from './figure'

/**
 * The tip control's phases. Structurally the same as `TipPhase` in
 * lib/payments/types.ts, so a surface passes `useTip(...).state` straight
 * in. Sent only after the server accepted; there is no Undo.
 */
export type TipControlPhase =
  | { phase: 'idle' }
  | { phase: 'sending'; amount: MoneyValue }
  | { phase: 'sent'; amount: MoneyValue }
  | { phase: 'failed'; amount: MoneyValue }
  | { phase: 'offline'; amount: MoneyValue }
  | { phase: 'needs-funds'; amount: MoneyValue; available: MoneyValue | null }

/** The words on the tip button for a phase. One place, one copy. */
export function tipButtonLabel(
  state: TipControlPhase,
  amount: MoneyValue | null,
  target: 'article' | 'passage'
): string {
  switch (state.phase) {
    case 'sending':
      return `Sending ${state.amount.display}`
    case 'sent':
      return `Sent ${state.amount.display}`
    case 'failed':
      return 'Try again'
    case 'offline':
      return 'Offline'
    case 'needs-funds':
      return `Add money to tip ${state.amount.display}`
    case 'idle':
      if (!amount) return 'Choose an amount'
      return target === 'passage'
        ? `Tip this line ${amount.display}`
        : `Tip ${amount.display}`
  }
}

/** What a screen reader hears when the phase changes, once. */
export function tipAnnouncement(
  state: TipControlPhase,
  recipient: string
): { polite: string; assertive: string } {
  switch (state.phase) {
    case 'sending':
      return {
        polite: `Sending ${state.amount.display} to ${recipient}.`,
        assertive: '',
      }
    case 'sent':
      return {
        polite: `Sent ${state.amount.display} to ${recipient}.`,
        assertive: '',
      }
    case 'failed':
      return {
        polite: '',
        assertive: 'That tip did not go through. You were not charged.',
      }
    case 'offline':
      return {
        polite: 'You are offline. Tip again when you are back online.',
        assertive: '',
      }
    case 'needs-funds':
      return {
        polite: `Add money to tip ${state.amount.display}.`,
        assertive: '',
      }
    case 'idle':
      return { polite: '', assertive: '' }
  }
}

/**
 * Cents from what a reader typed in "Other": "2", "2.5", "2.50", "$2.50".
 * Null for anything else. Limits are the money layer's to check.
 */
export function centsFromInput(text: string): number | null {
  const match = /^\$?\s*(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!match) return null
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || 0)
  return cents > 0 ? cents : null
}
