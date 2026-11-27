import type { Metadata } from 'next'
import { TabPageLoader } from '@/components/tab/TabPageLoader'

export const metadata: Metadata = {
  title: 'Tab',
}

export default function DashboardTabPage() {
  return <TabPageLoader />
}
