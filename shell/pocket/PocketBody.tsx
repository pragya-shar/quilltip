'use client'

import { Suspense } from 'react'
import { MoneyFigure } from '@/system/components/MoneyFigure'
import { LazyPocketContent } from './loadPocket'

/**
 * The balance's content inside the sheet or the panel, with a figure-shaped
 * placeholder for the moment it takes to load. This boundary sits inside an
 * overlay, never above reading content (D19).
 */
export function PocketBody() {
  return (
    <Suspense
      fallback={
        <div className="qt-pocket" aria-busy="true">
          <MoneyFigure value={null} status="loading" size="xl" />
        </div>
      }
    >
      <LazyPocketContent />
    </Suspense>
  )
}
