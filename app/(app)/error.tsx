'use client'

import { useEffect } from 'react'
import { Button } from '@/system/components/Button'
import { Notice } from '@/system/components/Notice'

/**
 * A page that failed to render. The shell (navigation, toasts, payments)
 * stays; only the page area shows this, with a way to try again.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Page error:', error.digest ?? error)
  }, [error])
  return (
    <div className="qt-page">
      <Notice
        tone="failure"
        live
        title="This page did not load"
        action={
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        }
      >
        Your balance and anything you sent are unaffected.
      </Notice>
    </div>
  )
}
