import type { MoneyValue } from './figure'

/**
 * The tip control's phases. Structurally the same as `TipPhase`
 * in lib/payments/types.ts, so a surface passes `useTip(...).state` straight
 * in. Sent only after the server accepted; there is no Undo. "Refused" is
 * `failed` (the server said no) or `needs-funds` (checked before sending);
 * "unavailable" is the control's `unavailable` prop.
 *
 * `holding` is the hold before sending, between `idle` and `sending`: the
 * tip can still be cancelled; the control's `hold` prop carries Cancel and
 * +$1. `other` is the slot for one more phase the money layer adds, with
 * its own words.
 */
export type TipControlPhase =
  | { phase: 'idle' }
  | { phase: 'holding'; amount: MoneyValue }
  | { phase: 'sending'; amount: MoneyValue }
  | { phase: 'sent'; amount: MoneyValue }
  | { phase: 'failed'; amount: MoneyValue }
  | { phase: 'offline'; amount: MoneyValue }
  | { phase: 'needs-funds'; amount: MoneyValue; available: MoneyValue | null }
  | { phase: 'other'; words: string; amount: MoneyValue; busy: boolean }

/** The amount as a label says it: the short text when the money layer
 * gives one ("$1"), else the display text ("$1.00"). */
export function labelAmount(value: MoneyValue): string {
  return value.short ?? value.display
}

/**
 * The amount the tip button states and a press sends: one value for both.
 * Idle: the chosen amount. After a refusal or a short balance: the amount
 * chosen since, else the one that was tried. Every other phase: the
 * phase's own. Null when there is none (the press opens the amount tray).
 */
export function buttonAmount(
  state: TipControlPhase,
  amount: MoneyValue | null
): MoneyValue | null {
  switch (state.phase) {
    case 'idle':
      return amount
    case 'failed':
    case 'needs-funds':
      return amount ?? state.amount
    default:
      return state.amount
  }
}

/**
 * How long the button ignores presses after the phase becomes this one, in
 * ms. A refusal or a short balance turns the button into another action
 * (Try again, Add money): the second tap of a double tap that sent the
 * first must not start it.
 */
export function pressHoldAfter(phase: TipControlPhase['phase']): number {
  return phase === 'failed' || phase === 'needs-funds' ? 500 : 0
}

/**
 * Whether the reader may choose the amount in this phase: only where the
 * button's amount is the chosen one (`buttonAmount` reads it). In every
 * other phase the amount is the phase's own, so the amount control is not
 * shown and the words and the press can never differ.
 */
export function amountChoosable(state: TipControlPhase): boolean {
  return (
    state.phase === 'idle' ||
    state.phase === 'failed' ||
    state.phase === 'needs-funds'
  )
}

/** "Tomás Reyes" → "Tomás": the button names the writer by first name. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] ?? name
}

/**
 * The words on the tip button for a phase, and the amount apart from them:
 * the words may be cut with an ellipsis, the amount never is.
 */
export function tipButtonParts(
  state: TipControlPhase,
  amount: MoneyValue | null,
  target: 'article' | 'passage',
  recipient = ''
): { words: string; amount: string | null } {
  switch (state.phase) {
    case 'holding':
    case 'sending':
      return { words: 'Sending', amount: labelAmount(state.amount) }
    case 'sent':
      return { words: 'Sent', amount: labelAmount(state.amount) }
    // After a refusal the reader may choose another amount: the button
    // states the amount it will send now, as the amount control does.
    case 'failed':
      return {
        words: 'Try again: tip',
        amount: labelAmount(buttonAmount(state, amount)!),
      }
    case 'offline':
      return { words: 'Offline. You can tip when you reconnect.', amount: null }
    case 'needs-funds':
      return {
        words: 'Add money to tip',
        amount: labelAmount(buttonAmount(state, amount)!),
      }
    case 'other':
      return { words: state.words, amount: labelAmount(state.amount) }
    case 'idle': {
      if (!amount) return { words: 'Choose an amount', amount: null }
      if (target === 'passage')
        return { words: 'Tip this line', amount: labelAmount(amount) }
      const name = firstName(recipient)
      return {
        words: name ? `Tip ${name}` : 'Tip',
        amount: labelAmount(amount),
      }
    }
  }
}

/** The whole label, as a screen reader and a test read it. */
export function tipButtonLabel(
  state: TipControlPhase,
  amount: MoneyValue | null,
  target: 'article' | 'passage',
  recipient = ''
): string {
  const parts = tipButtonParts(state, amount, target, recipient)
  return parts.amount ? `${parts.words} ${parts.amount}` : parts.words
}

/** The line that explains a refusal (it takes focus), if any. */
export function tipNote(state: TipControlPhase): string | null {
  return state.phase === 'failed'
    ? 'That tip did not go through. You were not charged.'
    : null
}

/** Said once when the reader cancels a hold. */
export const HOLD_CANCELLED = 'Cancelled. Nothing was sent.'

/**
 * Cents from what a reader typed in "Other": "2", "2.5", "2.50", "$2.50",
 * and the decimal comma ("2,50"). Null for anything else, and for a
 * thousands separator ("1,000"), which would read as a decimal comma.
 * Limits are the money layer's to check.
 */
export function centsFromInput(text: string): number | null {
  const match = /^\$?\s*(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(text.trim())
  if (!match) return null
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || 0)
  return cents > 0 ? cents : null
}
