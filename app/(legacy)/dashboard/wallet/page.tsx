import type { Metadata } from 'next'
import { DashboardWalletContent } from '@/components/dashboard/DashboardWalletContent'

export const metadata: Metadata = {
  title: 'Wallet',
}

export default function DashboardWalletPage() {
  return <DashboardWalletContent />
}
