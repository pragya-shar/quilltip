import type { Metadata } from 'next'
import { EarningsScreenLive } from '@/components/payments/EarningsScreenLive'

export const metadata: Metadata = {
  title: 'Earnings',
}

export default function DashboardEarningsPage() {
  return <EarningsScreenLive />
}
