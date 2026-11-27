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

/**
 * The words on the tip button for a phase, and the amount apart from them:
 * the words may be cut with an ellipsis, the amount never is.
 */
export function tipButtonParts(
  state: TipControlPhase,
  amount: MoneyValue | null,
  target: 'article' | 'passage'
): { words: string; amount: string | null } {
  switch (state.phase) {
    case 'sending':
      return { words: 'Sending', amount: state.amount.display }
    case 'sent':
      return { words: 'Sent', amount: state.amount.display }
    case 'failed':
      return { words: 'Try again', amount: null }
    case 'offline':
      return { words: 'Offline', amount: null }
    case 'needs-funds':
      return { words: 'Add money to tip', amount: state.amount.display }
    case 'idle':
      if (!amount) return { words: 'Choose an amount', amount: null }
      return {
        words: target === 'passage' ? 'Tip this line' : 'Tip',
        amount: amount.display,
      }
  }
}

/** The whole label, as a screen reader and a test read it. */
export function tipButtonLabel(
  state: TipControlPhase,
  amount: MoneyValue | null,
  target: 'article' | 'passage'
): string {
  const parts = tipButtonParts(state, amount, target)
  return parts.amount ? `${parts.words} ${parts.amount}` : parts.words
}

/** The line under the control that explains a failure or a block, if any. */
export function tipNote(state: TipControlPhase): string | null {
  switch (state.phase) {
    case 'failed':
      return 'That tip did not go through. You were not charged.'
    case 'offline':
      return 'You are offline. Tip again when you are back online.'
    default:
      return null
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
