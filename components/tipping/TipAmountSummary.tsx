import {
  calculateTipBreakdown,
  formatTipAmount,
} from '@/lib/stellar/highlight-utils'

interface TipAmountSummaryProps {
  amountCents: number
  message?: string
}

export function TipAmountSummary({
  amountCents,
  message,
}: TipAmountSummaryProps) {
  const breakdown = calculateTipBreakdown(amountCents)
  return (
    <div className="tip-summary">
      <p className="tip-summary-total">
        <span>Tip amount</span>
        <strong>{formatTipAmount(amountCents)}</strong>
      </p>
      <dl className="tip-breakdown">
        <div>
          <dt>To the author · 97.5%</dt>
          <dd>{breakdown.authorShareFormatted}</dd>
        </div>
        <div>
          <dt>Platform fee · 2.5%</dt>
          <dd>{breakdown.platformFeeFormatted}</dd>
        </div>
      </dl>
      {message ? (
        <p className="tip-message">
          <span className="font-medium">Your note: </span>
          &ldquo;{message}&rdquo;
        </p>
      ) : null}
    </div>
  )
}
