'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { FailurePageShell } from '@/components/error/FailurePageShell'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (error.digest !== undefined) {
      console.error('Route error:', error, 'digest:', error.digest)
    } else {
      console.error('Route error:', error)
    }
  }, [error])

  return (
    <main>
      <FailurePageShell
        label="Page unavailable"
        heading={<h1 className="failure-heading">Something went wrong</h1>}
        description="This page ran into a problem. Try again, or go back to the home page."
        actions={
          <>
            <button type="button" onClick={reset} className="failure-action">
              Try again
            </button>
            <Link href="/" className="failure-link">
              Go home
            </Link>
          </>
        }
      />
    </main>
  )
}
