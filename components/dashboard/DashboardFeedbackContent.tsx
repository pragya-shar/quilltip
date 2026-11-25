'use client'

import { useSearchParams } from 'next/navigation'
import { FeedbackForm } from '@/components/beta/FeedbackForm'

export function DashboardFeedbackContent() {
  const from = useSearchParams().get('from') ?? undefined
  return (
    <div className="account-feedback-page">
      <div className="account-heading">
        <h1>Feedback</h1>
        <p>
          QuillTip is in beta. Tell us what broke, what confused you, or what
          you’d like next.
        </p>
      </div>
      <FeedbackForm fromPath={from?.startsWith('/') ? from : undefined} />
    </div>
  )
}
