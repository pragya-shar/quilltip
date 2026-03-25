'use client'

import Link from 'next/link'
import { useEffect } from 'react'

import { ErrorPageIllustration } from '@/components/error/ErrorPageIllustration'
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-cream px-4 py-8">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-quill-200 bg-white/90 p-8 text-center shadow-sm backdrop-blur-sm">
        <ErrorPageIllustration className="mb-6" />
        <h1 className="font-display text-2xl font-semibold text-brand-blue">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm text-quill-600">
          This page ran into a problem. Try again, or go back to the home page.
        </p>
        <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Button type="button" onClick={reset} className="w-full sm:w-auto">
            Try again
          </Button>
          <Button variant="outline" asChild className="w-full sm:w-auto">
            <Link href="/">Go Home</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
