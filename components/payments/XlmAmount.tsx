import { estimateXlmCopy } from '@/lib/copy/payment-states'
import { formatXlm } from '@/lib/payments/format'
import { cn } from '@/lib/utils'
import type { BaseUnits } from './payment-types'
import './payments.css'

/**
 * An XLM amount inside a sentence or a row: tabular figures and the unit kept
 * on the same line. Exact amounts keep full stroop precision; `estimate`
 * reads "About" and rounds (#670).
 */
export function XlmAmount({
  amount,
  estimate = false,
  className,
}: {
  amount: BaseUnits
  estimate?: boolean
  className?: string
}) {
  return (
    <span className={cn('pay-xlm', className)}>
      {estimate ? estimateXlmCopy(amount) : formatXlm(amount)}
    </span>
  )
}
