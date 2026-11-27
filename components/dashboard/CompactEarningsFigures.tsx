import { Coins } from 'lucide-react'
import {
  AT_LEAST,
  EARNINGS_UPDATING_NOTE,
  earningsLabel,
  formatXlmFromStroops,
  networkLabelLowercase,
  usdEstimateNote,
} from '@/lib/copy/network-status'

type CompactEarningsFiguresProps = {
  earnedStroops: string
  estimatedUsd: number
  tipCount: number
  isTestnet: boolean
  /** False when the figures are lower bounds (`getMyEarningsSummary`). */
  complete: boolean
  /** Tips in the figures without a trusted USD amount. */
  unpricedTipCount: number
  /** The row's lifetime totals are being rebuilt. */
  updating: boolean
}

/**
 * The dashboard's earnings figures. The XLM, the dollars and the count cover
 * the same tips (#552); a lower bound says "At least"; while the totals are
 * rebuilt, a note says so under the figures.
 */
export function CompactEarningsFigures({
  earnedStroops,
  estimatedUsd,
  tipCount,
  isTestnet,
  complete,
  unpricedTipCount,
  updating,
}: CompactEarningsFiguresProps) {
  const bound = !complete
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {isTestnet ? 'Earned (testnet)' : earningsLabel()}
        </span>
        <Coins className="h-4 w-4 text-success-foreground" aria-hidden />
      </div>
      {bound && <p className="text-sm text-muted-foreground">{AT_LEAST}</p>}
      <p className="text-2xl font-bold text-foreground tabular-nums">
        {formatXlmFromStroops(earnedStroops, 2)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {usdEstimateNote(
          estimatedUsd,
          isTestnet,
          !complete || unpricedTipCount > 0
        )}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {bound ? `${AT_LEAST} ` : ''}
        {tipCount.toLocaleString('en-US')} {networkLabelLowercase()} tip
        {tipCount === 1 ? '' : 's'} received
      </p>
      {updating && (
        <p className="mt-1 text-sm text-muted-foreground">
          {EARNINGS_UPDATING_NOTE}
        </p>
      )}
    </>
  )
}
