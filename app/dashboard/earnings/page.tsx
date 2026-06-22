import type { Metadata } from 'next'
import { EarningsDashboard } from '@/components/dashboard/EarningsDashboard'

export const metadata: Metadata = {
  title: 'Earnings',
}

export default function DashboardEarningsPage() {
  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-2">Earnings</h2>
        <p className="text-muted-foreground">
          Track testnet tip activity and withdraw your earnings.
        </p>
      </div>
      <EarningsDashboard />
    </div>
  )
}
