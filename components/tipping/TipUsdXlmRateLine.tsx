import { formatUsdToXlmHint } from '@/lib/tipping/xlmRateDisplay'

export function TipUsdXlmRateLine({
  priceUsd,
}: {
  priceUsd: number | null
}) {
  if (priceUsd === null) return null
  const text = formatUsdToXlmHint(priceUsd)
  if (!text) return null
  return (
    <p className="text-xs text-muted-foreground/90 mt-1" aria-live="polite">
      {text}
    </p>
  )
}
