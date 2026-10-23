'use client'

import { useAuth } from '@/components/providers/AuthContext'
import { DashboardWalletSkeleton } from '@/components/dashboard/DashboardWalletSkeleton'
import { WalletAccountContent } from '@/components/dashboard/WalletAccountContent'

export function DashboardWalletContent() {
  const { user } = useAuth()
  if (!user) return <DashboardWalletSkeleton />
  // Remount drafts, optimistic address state, and receipts together on account change.
  return <WalletAccountContent key={user._id} user={user} />
}
