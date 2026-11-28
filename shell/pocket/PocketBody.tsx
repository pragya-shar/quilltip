'use client'

import { Suspense, useState } from 'react'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { SheetLoadBoundary } from '../sheets/SheetLoadBoundary'
import { forgetPocket, lazyPocketContent } from './loadPocket'

/**
 * The balance's content inside the sheet or the panel: a figure-shaped
 * placeholder while it loads, and "This did not load" with Try again if it
 * fails. A failure stays inside the overlay; the page is never replaced.
 */
export function PocketBody() {
  const [attempt, setAttempt] = useState(0)
  const Content = lazyPocketContent()
  return (
    <SheetLoadBoundary
      key={attempt}
      onRetry={() => {
        forgetPocket()
        setAttempt((n) => n + 1)
      }}
    >
      <Suspense
        fallback={
          <div className="qt-pocket" aria-busy="true">
            <MoneyFigure value={null} status="loading" size="xl" />
          </div>
        }
      >
        <Content />
      </Suspense>
    </SheetLoadBoundary>
  )
}
