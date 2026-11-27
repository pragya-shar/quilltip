import {
  AT_LEAST,
  EARNINGS_UPDATING,
  EARNINGS_UPDATING_NOTE,
  earningsLabel,
  formatXlmFromStroops,
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
  /** The totals are being rebuilt: no figures to show yet. */
  updating?: boolean
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
}: CreatorStatsPanelProps) {
  // The count and the earned figures cover the same tips (#552).
  const bound = complete || updating ? undefined : AT_LEAST
  const stats = [
    { label: 'Articles', value: articleCount.toLocaleString('en-US') },
    {
      label: 'Tips received',
      bound,
      value: updating
        ? EARNINGS_UPDATING
        : tipsReceivedCount.toLocaleString('en-US'),
      note: 'From wallets and settled tabs',
    },
    { label: 'NFTs owned', value: nftsOwned.toLocaleString('en-US') },
    {
      label: isTestnet ? 'Earned (testnet)' : earningsLabel(),
      bound,
      value: updating
        ? EARNINGS_UPDATING
        : formatXlmFromStroops(earnedStroops, 2),
      note: updating
        ? EARNINGS_UPDATING_NOTE
        : usdEstimateNote(
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
