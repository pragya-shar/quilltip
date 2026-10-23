'use client'

import { ReadingRoomShell } from '@/components/articles/ReadingRoomShell'

import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { ReadingRoom } from '@/components/articles/ReadingRoom'
import '@/components/articles/reading-room.css'

export default function ArticlesPage() {
  return (
    <ReadingRoomShell>
      <ErrorBoundary
        fallback={({ reset }) => (
          <main className="reading-room-main empty">
            <h1>Articles couldn’t load.</h1>
            <p>Your filters are still here.</p>
            <button onClick={reset}>Try again</button>
          </main>
        )}
      >
        <ReadingRoom />
      </ErrorBoundary>
    </ReadingRoomShell>
  )
}
