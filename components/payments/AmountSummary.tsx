import { useId } from 'react'
import { TESTNET_QUOTE_NOTE } from '@/lib/copy/payment-states'
import { formatCentsQuote, formatXlm } from '@/lib/payments/format'
import { cn } from '@/lib/utils'
import { TestnetLabel } from './TestnetLabel'
import type { AmountLine, BaseUnits } from './payment-types'
import './payments.css'

interface AmountSummaryProps {
  /** Label of the total, for example "Tip amount" or "Top-up". */
  label?: string
  /** Gross amount in stroops, from the prepare response or the event. */
  total: BaseUnits
  /**
   * Breakdown rows in the order shown, for example the author share and the
   * platform fee. The kit never derives them: pass the values Convex returned
   * or the contract emitted.
   */
  breakdown?: AmountLine[]
  /** Basket lines, shown above the total. */
  items?: AmountLine[]
  /** Price quote in US cents; shown as secondary text. */
  quoteCents?: number | null
  className?: string
}

/**
 * The amount and its split. XLM is primary; the cents quote is secondary and
 * marked as having no real value while QuillTip runs on testnet.
 */
export function AmountSummary({
  label = 'Tip amount',
  total,
  breakdown = [],
  items = [],
  quoteCents,
  className,
}: AmountSummaryProps) {
  const labelId = useId()
  const quote = formatCentsQuote(quoteCents)
  return (
    <section className={cn('pay-amount', className)} aria-labelledby={labelId}>
      {items.length > 0 ? (
        <ul className="pay-amount-items" aria-label="Tips in this payment">
          {items.map((item, index) => (
            <li key={`${index}-${item.label}`}>
              <span className="pay-amount-item-label">{item.label}</span>
              <span className="pay-amount-figure">
                {formatXlm(item.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="pay-amount-total">
        <span id={labelId}>{label}</span>
        <strong className="pay-amount-figure">{formatXlm(total)}</strong>
      </p>
      <p className="pay-amount-caption">
        <TestnetLabel />
        {quote ? (
          <span>
            About {quote}, {TESTNET_QUOTE_NOTE}
          </span>
        ) : null}
      </p>
      {breakdown.length > 0 ? (
        <dl className="pay-amount-breakdown">
          {breakdown.map((line, index) => (
            <div key={`${index}-${line.label}`}>
              <dt>{line.label}</dt>
              <dd className="pay-amount-figure">{formatXlm(line.amount)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
