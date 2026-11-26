'use client'

import type { ComponentProps } from 'react'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { ReadingRoom } from '@/components/articles/ReadingRoom'

export function ReadingRoomPage(props: ComponentProps<typeof ReadingRoom>) {
  return (
    <ErrorBoundary
      fallback={({ reset }) => (
        <main className="reading-room-main empty">
          <h1>Articles couldn’t load.</h1>
          <p>Your filters are still here.</p>
          <button onClick={reset}>Try again</button>
        </main>
      )}
    >
      <ReadingRoom {...props} />
    </ErrorBoundary>
  )
}
