'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="mx-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <h2 className="mb-2 text-2xl font-bold text-red-800">
          Something went wrong!
        </h2>
        <p className="mb-4 text-sm text-red-600">
          {error.message || 'An unexpected error occurred'}
        </p>
        <button
          onClick={reset}
          className="rounded bg-red-600 px-4 py-2 text-white transition-colors hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
