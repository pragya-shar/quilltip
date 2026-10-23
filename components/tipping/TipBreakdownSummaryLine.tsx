interface TipBreakdownSummaryLineProps {
  totalFormatted: string
  authorFormatted: string
  platformFeeFormatted: string
}

export function TipBreakdownSummaryLine({
  totalFormatted,
  authorFormatted,
  platformFeeFormatted,
}: TipBreakdownSummaryLineProps) {
  return (
    <dl className="tip-breakdown" aria-label="Tip breakdown">
      <div>
        <dt>Total</dt>
        <dd>{totalFormatted}</dd>
      </div>
      <div>
        <dt>To the author · 97.5%</dt>
        <dd>{authorFormatted}</dd>
      </div>
      <div>
        <dt>Platform fee · 2.5%</dt>
        <dd>{platformFeeFormatted}</dd>
      </div>
    </dl>
  )
}
