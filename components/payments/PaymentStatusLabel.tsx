import { STATUS_LABEL } from '@/lib/copy/payment-states'
import { cn } from '@/lib/utils'
import type { PaymentPhase } from './payment-types'
import './payments.css'

const TONE: Record<PaymentPhase, string> = {
  simulating: 'info',
  signing: 'info',
  sending: 'info',
  checking: 'info',
  accepted: 'info',
  confirmed: 'success',
  settled: 'success',
  'sent-to-registered': 'info',
  'under-review': 'warning',
  shortfall: 'warning',
  expired: 'warning',
  failed: 'danger',
  unpaid: 'danger',
  'void-reset': 'neutral',
}

/**
 * A short status for a row in a payment history, for example "Settling" or
 * "Not paid". Text carries the meaning; the dot only repeats it.
 */
export function PaymentStatusLabel({
  phase,
  className,
}: {
  phase: PaymentPhase
  className?: string
}) {
  return (
    <span
      className={cn('pay-status', className)}
      data-tone={TONE[phase]}
      data-state={phase}
    >
      <span className="pay-status-dot" aria-hidden="true" />
      {STATUS_LABEL[phase]}
    </span>
  )
}
