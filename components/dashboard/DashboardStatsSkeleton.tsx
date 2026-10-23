export function DashboardStatsSkeleton() {
  return (
    <div className="account-stats" role="status" aria-label="Loading stats">
      <div className="account-heading">
        <h1>Stats</h1>
        <p>Overview of your publishing activity and testnet tips.</p>
      </div>
      <span className="sr-only">Loading stats…</span>
      <div className="account-stat-grid" aria-hidden="true">
        {['Articles', 'Tips received', 'NFTs owned', 'Earned (USD)'].map(
          (label) => (
            <div className="account-stat" key={label}>
              <div>{label}</div>
              <div className="account-stat-placeholder" />
            </div>
          )
        )}
      </div>
    </div>
  )
}
