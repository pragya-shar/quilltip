export function DashboardWalletSkeleton() {
  return (
    <div className="account-loading" role="status" aria-live="polite">
      <h1>Wallet</h1>
      <p>Loading wallet…</p>
      <div className="account-loading-line" />
      <div className="account-loading-line" />
    </div>
  )
}
