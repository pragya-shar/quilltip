import { useId } from 'react'
import {
  ESTIMATE,
  estimateFigureCopy,
  quoteCopy,
} from '@/lib/copy/payment-states'
import { estimateSummary, formatCentsQuote } from '@/lib/payments/format'
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
  /**
   * The line under an estimate. Defaults to the wallet sentence; pass
   * `ESTIMATE.tabCaption` while a tab can send the same amount.
   */
  estimateCaption?: string
  className?: string
}

/**
 * The amount and its split. XLM is primary; the cents quote is secondary.
 * Every summary carries the testnet label; an estimate adds its detail.
 */
export function AmountSummary({
  label = 'Tip amount',
  total,
  breakdown = [],
  items = [],
  quoteCents,
  estimate = false,
  estimateCaption = ESTIMATE.caption,
  className,
}: AmountSummaryProps) {
  const labelId = useId()
  const quote = formatCentsQuote(quoteCents)
  // An estimate rounds as one summary: every figure at the total's
  // precision, and the breakdown adds up to the total shown (#670). Items
  // round to the same precision.
  const figures = estimate
    ? {
        ...estimateSummary(
          total,
          breakdown.map((line) => line.amount)
        ),
        items: estimateSummary(
          total,
          items.map((item) => item.amount)
        ).parts,
      }
    : null
  const figure = (amount: BaseUnits, shown: string | undefined) =>
    shown === undefined ? (
      <XlmAmount className="pay-amount-figure" amount={amount} />
    ) : (
      <span className="pay-xlm pay-amount-figure">{shown}</span>
    )
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
              {figure(
                item.amount,
                figures ? estimateFigureCopy(figures.items[index]!) : undefined
              )}
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
      <p className="pay-amount-total">
        <span id={labelId}>{label}</span>
        <strong>
          {figure(
            total,
            figures ? estimateFigureCopy(figures.total) : undefined
          )}
        </strong>
      </p>
      <p className="pay-amount-caption">
        {/* An estimate is where a reader first meets the amount (#670). */}
        <TestnetLabel detail={estimate} />
        {quote ? <span>{quoteCopy(quote)}</span> : null}
        {estimate ? <span>{estimateCaption}</span> : null}
      </p>
      {breakdown.length > 0 ? (
        <dl className="pay-amount-breakdown">
          {breakdown.map((line, index) => (
            <div key={`${index}-${line.label}`}>
              <dt>{line.label}</dt>
              <dd>
                {figure(
                  line.amount,
                  figures
                    ? estimateFigureCopy(figures.parts[index]!)
                    : undefined
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
