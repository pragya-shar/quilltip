'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { ErrorPageIllustration } from '@/components/error/ErrorPageIllustration'
import { FailurePageShell } from '@/components/error/FailurePageShell'
import { Button } from '@/components/ui/button'

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
    <FailurePageShell
      illustration={<ErrorPageIllustration className="mb-6" />}
      heading={
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Something went wrong
        </h1>
      }
      description="This page ran into a problem. Try again, or go back to the home page."
      actions={
        <>
          <Button
            type="button"
            onClick={reset}
            className="w-full sm:w-auto"
          >
            Try again
          </Button>
          <Button variant="outline" asChild className="w-full sm:w-auto">
            <Link href="/">Go Home</Link>
          </Button>
        </>
      }
    />
  )
}
