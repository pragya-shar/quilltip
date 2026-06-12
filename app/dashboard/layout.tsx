import type { Metadata } from 'next'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = {
  title: {
    template: '%s | Dashboard | Quilltip',
    default: 'Dashboard | Quilltip',
  },
  description:
    'Manage your Stellar wallet, testnet earnings, and creator stats on Quilltip.',
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <DashboardShell>{children}</DashboardShell>
}
