import type { Metadata } from 'next'
import { BalanceScreenLive } from '@/components/payments/BalanceScreenLive'

export const metadata: Metadata = {
  title: 'Balance',
}

export default function DashboardBalancePage() {
  return <BalanceScreenLive />
}
