import '@/components/account/account.css'
import type { Metadata } from 'next'
import { DashboardShell } from '@/components/dashboard/DashboardShell'

export const metadata: Metadata = {
  title: {
    template: '%s | Dashboard | QuillTip',
    default: 'Dashboard | QuillTip',
  },
  description: 'Manage your Stellar wallet and creator stats on Quilltip.',
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <DashboardShell>{children}</DashboardShell>
}
