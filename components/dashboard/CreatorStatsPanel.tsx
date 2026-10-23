type CreatorStatsPanelProps = {
  articleCount: number
  tipsReceivedCount: number
  totalEarnedUsd: number
  nftsOwned: number
}

export function CreatorStatsPanel({
  articleCount,
  tipsReceivedCount,
  totalEarnedUsd,
  nftsOwned,
}: CreatorStatsPanelProps) {
  const stats = [
    { label: 'Articles', value: articleCount.toLocaleString('en-US') },
    {
      label: 'Tips received',
      value: tipsReceivedCount.toLocaleString('en-US'),
    },
    { label: 'NFTs owned', value: nftsOwned.toLocaleString('en-US') },
    {
      label: 'Earned (USD)',
      value: totalEarnedUsd.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
      }),
    },
  ]

  return (
    <dl className="account-stat-grid" aria-label="Creator statistics">
      {stats.map(({ label, value }) => (
        <div className="account-stat" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
