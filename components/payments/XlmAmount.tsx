import { ESTIMATE } from '@/lib/copy/payment-states'
import { formatXlm } from '@/lib/payments/format'
import { cn } from '@/lib/utils'
import type { BaseUnits } from './payment-types'
import './payments.css'

/**
 * An XLM amount inside a sentence or a row: full stroop precision, tabular
 * figures, and the unit kept on the same line. `estimate` reads "About".
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
      {estimate ? `${ESTIMATE.prefix} ` : null}
      {formatXlm(amount)}
    </span>
  )
}
