import { useId } from 'react'
import { ESTIMATE, quoteCopy } from '@/lib/copy/payment-states'
import { formatCentsQuote } from '@/lib/payments/format'
import { cn } from '@/lib/utils'
import { PaymentStatusLabel } from './PaymentStatusLabel'
import { TestnetLabel } from './TestnetLabel'
import { XlmAmount } from './XlmAmount'
import type { AmountLine, BaseUnits } from './payment-types'
import './payments.css'

interface AmountSummaryProps {
  /** Label of the total, for example "Tip amount" or "Top-up". */
  label?: string
  /** Gross amount in stroops, from the prepare response or the event. */
  total: BaseUnits
  /**
   * Breakdown rows in the order shown, for example the author share and the
   * platform fee. Pass the values Convex returned or the contract emitted.
   */
  breakdown?: AmountLine[]
  /** Basket lines, shown above the total, each with an optional status. */
  items?: AmountLine[]
  /** Price quote in US cents; shown as secondary text. */
  quoteCents?: number | null
  /**
   * The figures are a client conversion before prepare returns. Every
   * figure reads "About …" and the caption says the final amount comes
   * before the wallet prompt.
   */
  estimate?: boolean
  /** An id for the total line, so an action can read it as its description. */
  totalId?: string
  className?: string
}

/**
 * The amount and its split. XLM is primary; the cents quote is secondary.
 * Every summary carries the testnet label.
 */
export function AmountSummary({
  label = 'Tip amount',
  total,
  breakdown = [],
  items = [],
  quoteCents,
  estimate = false,
  totalId,
  className,
}: AmountSummaryProps) {
  const labelId = useId()
  const quote = formatCentsQuote(quoteCents)
  return (
    <section
      className={cn('pay-amount', className)}
      aria-labelledby={labelId}
      data-estimate={estimate ? '' : undefined}
    >
      {items.length > 0 ? (
        <ul className="pay-amount-items" aria-label="Tips in this payment">
          {items.map((item, index) => (
            <li key={`${index}-${item.label}`}>
              <span className="pay-amount-item-label">{item.label}</span>
              <XlmAmount
                className="pay-amount-figure"
                amount={item.amount}
                estimate={estimate}
              />
              {item.status || item.note ? (
                <span className="pay-amount-item-state">
                  {item.status ? (
                    <PaymentStatusLabel phase={item.status} />
                  ) : null}
                  {item.note ? (
                    <span className="pay-amount-item-note">{item.note}</span>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="pay-amount-total" id={totalId}>
        <span id={labelId}>{label}</span>
        <strong>
          <XlmAmount
            className="pay-amount-figure"
            amount={total}
            estimate={estimate}
          />
        </strong>
      </p>
      <p className="pay-amount-caption">
        <TestnetLabel />
        {quote ? <span>{quoteCopy(quote)}</span> : null}
        {estimate ? <span>{ESTIMATE.caption}</span> : null}
      </p>
      {breakdown.length > 0 ? (
        <dl className="pay-amount-breakdown">
          {breakdown.map((line, index) => (
            <div key={`${index}-${line.label}`}>
              <dt>{line.label}</dt>
              <dd>
                <XlmAmount
                  className="pay-amount-figure"
                  amount={line.amount}
                  estimate={estimate}
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
