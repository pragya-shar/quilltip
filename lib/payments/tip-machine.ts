/**
 * The tip control's state machine (D3, D6, D7): one tap sends at once; the
 * control says "Sent" only after the server accepts; there is no Undo; a
 * second tap while a tip is in flight does nothing; offline and a low
 * balance are refused before anything is sent.
 *
 * `job` is what the runtime knows about the tip in flight (from its own send
 * or, after a reload, from the session listing the request as accepted).
 */
import { money } from './money'
import type { Cents, Money, TipPhase } from './types'

export type JobStatus =
  | { status: 'sending' }
  | { status: 'sent' }
  | { status: 'failed'; code: string }

export type TapCheck = {
  online: boolean
  /** Null until the balance is read: nothing is sent then. */
  available: Money | null
  /** Null when the reader can tip here. */
  unavailable: string | null
}

export type TapDecision =
  | { send: true; phase: TipPhase }
  | { send: false; phase: TipPhase }

/** What a tap does, from the current phase and the checks before sending. */
export function onTap(
  phase: TipPhase,
  cents: Cents,
  check: TapCheck,
  requestId: string
): TapDecision {
  // Double tap: one tip in flight at a time.
  if (phase.phase === 'sending') return { send: false, phase }
  const amount = money(cents)
  if (check.unavailable) return { send: false, phase }
  if (!check.online) return { send: false, phase: { phase: 'offline', amount } }
  if (!check.available) return { send: false, phase }
  if (cents > check.available.cents)
    return {
      send: false,
      phase: { phase: 'needs-funds', amount, available: check.available },
    }
  return { send: true, phase: { phase: 'sending', requestId, amount } }
}

/** The phase once the runtime reports on the tip in flight. */
export function onJob(phase: TipPhase, job: JobStatus | undefined): TipPhase {
  if (phase.phase !== 'sending' || !job) return phase
  if (job.status === 'sent')
    return { phase: 'sent', requestId: phase.requestId, amount: phase.amount }
  if (job.status === 'failed')
    return { phase: 'failed', code: job.code, amount: phase.amount }
  return phase
}

/** "Tip $1", "Tip this line $1", "Sending $1", "Sent $1", "Try again". */
export function tipLabel(
  phase: TipPhase,
  amount: Money | null,
  passage: boolean
): string {
  const short = (m: Money) => m.display.replace(/\.00$/, '')
  switch (phase.phase) {
    case 'sending':
      return `Sending ${short(phase.amount)}`
    case 'sent':
      return `Sent ${short(phase.amount)}`
    case 'failed':
      return 'Try again'
    case 'offline':
      return 'Offline'
    default:
      if (!amount) return passage ? 'Tip this line' : 'Tip'
      return passage ? `Tip this line ${short(amount)}` : `Tip ${short(amount)}`
  }
}
