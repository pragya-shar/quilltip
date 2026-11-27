import { Suspense } from 'react'
import type { Metadata } from 'next'
import { DashboardFeedbackContent } from '@/components/dashboard/DashboardFeedbackContent'

export const metadata: Metadata = {
  title: 'Feedback',
}

export default function DashboardFeedbackPage() {
  return (
    <Suspense fallback={null}>
      <DashboardFeedbackContent />
    </Suspense>
  )
}
