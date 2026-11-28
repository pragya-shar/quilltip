'use client'

import { Suspense, useLayoutEffect, useState } from 'react'
import { Sheet } from '@/system/components/Sheet'
import { Skeleton } from '@/system/components/Skeleton'
import { declaredSheet } from '.'
import {
  forgetSheet,
  lazySheetBody,
  loadedSheetBody,
  preloadSheet,
} from './loadSheet'
import { SheetLoadBoundary } from './SheetLoadBoundary'
import { holdPressedLook, sheetOpener } from './pressedOpener'

/** How long a first open waits for the body's code before drawing the
 * sheet with a placeholder. The code usually arrives in a few frames. */
export const FIRST_OPEN_WAIT_MS = 200

/**
 * A declared sheet, with its title (so focus lands on it, as on every
 * sheet) and its body in the same frame: a body whose code has arrived is
 * drawn at once; on a first open the sheet waits for the code, up to
 * FIRST_OPEN_WAIT_MS (the control that opened it keeps its pressed look
 * meanwhile), and then draws a placeholder while it loads inside.
 * These boundaries sit inside the overlay, never above reading content.
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
  const [waited, setWaited] = useState(() => Boolean(loadedSheetBody(id)))
  // Before the next paint, so no frame shows neither the press nor the
  // sheet.
  useLayoutEffect(() => {
    if (waited) return
    let live = true
    // The press that opened the sheet keeps its pressed look until the
    // sheet draws, so the wait never reads as a press that did nothing.
    const release = holdPressedLook(sheetOpener())
    const done = () => {
      release()
      if (live) setWaited(true)
    }
    const timer = setTimeout(done, FIRST_OPEN_WAIT_MS)
    preloadSheet(id)?.then(done, done)
    return () => {
      live = false
      release()
      clearTimeout(timer)
    }
  }, [id, waited])
  const declaration = declaredSheet(id)
  if (!declaration) return null
  const title =
    typeof declaration.title === 'function'
      ? declaration.title(props)
      : declaration.title
  const Body = loadedSheetBody(id) ?? lazySheetBody(id)
  return (
    <Sheet
      open={open && waited}
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
