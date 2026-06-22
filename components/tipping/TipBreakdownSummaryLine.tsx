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
    <p className="mb-3 text-sm text-muted-foreground text-center">
      Total {totalFormatted} · Author {authorFormatted} · Platform fee{' '}
      {platformFeeFormatted}
    </p>
  )
}
