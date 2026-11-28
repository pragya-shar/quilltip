import { ExactXlmFigure } from '@/components/dashboard/ExactXlmFigure'
import {
  AT_LEAST,
  EARNINGS_UPDATING_NOTE,
  earningsLabel,
  usdEstimateNote,
} from '@/lib/copy/network-status'

type CreatorStatsPanelProps = {
  articleCount: number
  tipsReceivedCount: number
  earnedStroops: string
  estimatedUsd: number
  isTestnet: boolean
  nftsOwned: number
  /** False when the figures are lower bounds (`getMyEarningsSummary`). */
  complete?: boolean
  /** Tips in the figures without a trusted USD amount. */
  unpricedTipCount?: number
  /** The row's lifetime totals are being rebuilt. */
  updating?: boolean
  /** `lifetime`: the totals cover wallet and settled tab tips (#552). */
  source?: 'lifetime' | 'previous'
}

export function CreatorStatsPanel({
  articleCount,
  tipsReceivedCount,
  earnedStroops,
  estimatedUsd,
  isTestnet,
  nftsOwned,
  complete = true,
  unpricedTipCount = 0,
  updating = false,
  source = 'lifetime',
}: CreatorStatsPanelProps) {
  // The count and the earned figures cover the same tips (#552).
  const bound = complete ? undefined : AT_LEAST
  const scope = updating
    ? EARNINGS_UPDATING_NOTE
    : source === 'lifetime'
      ? 'From wallets and settled tabs'
      : undefined
  const stats = [
    { label: 'Articles', value: articleCount.toLocaleString('en-US') },
    {
      label: 'Tips received',
      bound,
      value: tipsReceivedCount.toLocaleString('en-US'),
      note: scope,
    },
    { label: 'NFTs owned', value: nftsOwned.toLocaleString('en-US') },
    {
      label: isTestnet ? 'Earned (testnet)' : earningsLabel(),
      bound,
      // A settled, server-summed figure: every stroop (#676). The unit is
      // smaller, and a long figure breaks only after a thousands comma or
      // the decimal point, so it fits at 200% zoom on a phone.
      value: (
        <ExactXlmFigure
          stroops={earnedStroops}
          figureClassName="account-stat-figure"
          unitClassName="account-stat-unit"
        />
      ),
      note: usdEstimateNote(
        estimatedUsd,
        isTestnet,
        !complete || unpricedTipCount > 0
      ),
    },
  ]

  return (
    <dl className="account-stat-grid" aria-label="Creator statistics">
      {stats.map(({ label, bound, value, note }) => (
        <div className="account-stat" key={label}>
          <dt>{label}</dt>
          <dd>
            {bound && <span className="account-stat-bound">{bound}</span>}
            {value}
            {note && <span className="account-stat-note">{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
