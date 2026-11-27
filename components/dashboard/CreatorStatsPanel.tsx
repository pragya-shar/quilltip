import {
  TESTNET_NO_VALUE_NOTE,
  earningsLabel,
  formatUsd,
  formatXlmFromStroops,
} from '@/lib/copy/network-status'

type CreatorStatsPanelProps = {
  articleCount: number
  tipsReceivedCount: number
  earnedStroops: string
  estimatedUsd: number
  isTestnet: boolean
  nftsOwned: number
}

export function CreatorStatsPanel({
  articleCount,
  tipsReceivedCount,
  earnedStroops,
  estimatedUsd,
  isTestnet,
  nftsOwned,
}: CreatorStatsPanelProps) {
  const usdEstimate = `≈ ${formatUsd(estimatedUsd)}`
  const stats = [
    { label: 'Articles', value: articleCount.toLocaleString('en-US') },
    {
      label: 'Tips received',
      value: tipsReceivedCount.toLocaleString('en-US'),
      // The same tips as the earned figure (#552).
      note: 'From wallets and settled tabs',
    },
    { label: 'NFTs owned', value: nftsOwned.toLocaleString('en-US') },
    {
      label: isTestnet ? 'Earned (testnet)' : earningsLabel(),
      value: formatXlmFromStroops(earnedStroops, 2),
      note: isTestnet
        ? `${usdEstimate}, ${TESTNET_NO_VALUE_NOTE}`
        : usdEstimate,
    },
  ]

  return (
    <dl className="account-stat-grid" aria-label="Creator statistics">
      {stats.map(({ label, value, note }) => (
        <div className="account-stat" key={label}>
          <dt>{label}</dt>
          <dd>
            {value}
            {note && <span className="account-stat-note">{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}
