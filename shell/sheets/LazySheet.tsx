'use client'

import { Suspense, useState } from 'react'
import { Sheet } from '@/system/components/Sheet'
import { Skeleton } from '@/system/components/Skeleton'
import { declaredSheet } from '.'
import { forgetSheet, lazySheetBody } from './loadSheet'
import { SheetLoadBoundary } from './SheetLoadBoundary'

/**
 * A declared sheet: drawn at once with its title (so focus lands on it, as
 * on every sheet), with a placeholder while its body loads inside. These
 * boundaries sit inside the overlay, never above reading content.
 */
export function LazySheet({
  id,
  open,
  onClose,
  props,
}: {
  id: string
  open: boolean
  onClose: () => void
  props: unknown
}) {
  const [attempt, setAttempt] = useState(0)
  const declaration = declaredSheet(id)
  if (!declaration) return null
  const title =
    typeof declaration.title === 'function'
      ? declaration.title(props)
      : declaration.title
  const Body = lazySheetBody(id)
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      description={declaration.description}
    >
      <SheetLoadBoundary
        key={attempt}
        onRetry={() => {
          forgetSheet(id)
          setAttempt((n) => n + 1)
        }}
      >
        <Suspense
          fallback={
            <div
              className="qt-sheet-loading"
              aria-busy="true"
              aria-label="Loading"
            >
              <Skeleton width="70%" />
              <Skeleton width="45%" />
              <Skeleton shape="block" height="3.5rem" />
            </div>
          }
        >
          <Body props={props} close={onClose} />
        </Suspense>
      </SheetLoadBoundary>
    </Sheet>
  )
}
