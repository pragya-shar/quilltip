'use client'

import { useEffect } from 'react'
import {
  readReadingProgress,
  saveReadingProgress,
  type ReadingPosition,
} from '@/lib/articles/readingProgress'
import {
  READING_LINE,
  positionIn,
  scrollDeltaFor,
  shouldRestore,
} from './readingPosition'

const IMAGE_LAYOUT_WAIT_MS = 2000
const SCROLL_KEYS = new Set([
  ' ',
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
  'Home',
  'End',
])

type Options = {
  /** The article body, as rendered by the server. */
  body: () => HTMLElement | null
  /** Called once the reader is back at their place. */
  onRestored?: () => void
  /** Called with each place saved, for stores beside this one. */
  onSave?: (position: ReadingPosition) => void
  /**
   * The saved sentence to return to, when there is one: the view puts it at
   * the reading line. Without it, the saved scroll share is used.
   */
  sentence?: () => Range | null
}

/**
 * Keeps the reader's place in an article and returns them to it on the
 * next open (extracted from the legacy reader). The place is saved while
 * scrolling and on leaving; on open, the page scrolls back once the body
 * has its height, waits a bounded time for eager images to take their
 * space, and gives up the moment the reader scrolls, taps or presses a
 * scroll key. Nothing is chosen: `onRestored` is where the view shows its
 * quiet margin tick.
 */
export function useReadingPosition(
  id: string,
  { body, onRestored, onSave, sentence }: Options
) {
  useEffect(() => {
    const path = location.pathname
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    const position = shouldRestore({
      hash: location.hash,
      navigationType: navigation?.type,
      aimed: new URLSearchParams(location.search).has('highlight'),
    })
      ? readReadingProgress().find((entry) => entry.id === id)
      : undefined
    let restoring = Boolean(position)
    let frame = 0
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let pending: ReadingPosition | undefined
    let imageTimer: ReturnType<typeof setTimeout> | undefined
    let imageWaitExpired = false
    let restoredWhileWaiting = false
    let announced = false
    const root = body()

    const save = () => {
      if (pending) {
        saveReadingProgress(pending)
        onSave?.(pending)
      }
      pending = undefined
    }

    const onScroll = () => {
      if (restoring || location.pathname !== path || window.scrollY <= 0) return
      const bounds = body()?.getBoundingClientRect()
      if (!bounds) return
      const next = positionIn(id, bounds, window.innerHeight)
      if (!next) return
      pending = next
      clearTimeout(saveTimer)
      saveTimer = setTimeout(save, 150)
    }

    const resize = new ResizeObserver(() => restore())
    function stopObservingLayout() {
      resize.disconnect()
      root?.removeEventListener('load', restore, true)
      root?.removeEventListener('error', restore, true)
      clearTimeout(imageTimer)
    }
    function finish() {
      restoring = false
      if (!announced) {
        announced = true
        onRestored?.()
      }
    }
    function cancelRestore() {
      if (!restoring) return
      stopObservingLayout()
      cancelAnimationFrame(frame)
      restoring = false
    }
    function onKeyDown(event: KeyboardEvent) {
      if (SCROLL_KEYS.has(event.key)) cancelRestore()
    }

    function restore() {
      if (!restoring || !position || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!restoring) return
        const node = body()
        const bounds = node?.getBoundingClientRect()
        if (!node || !bounds?.height) return
        const waiting = Array.from(node.querySelectorAll('img')).some(
          (img) => img.loading !== 'lazy' && !img.complete
        )
        if (waiting && !imageWaitExpired) {
          imageTimer ??= setTimeout(() => {
            imageWaitExpired = true
            restore()
          }, IMAGE_LAYOUT_WAIT_MS)
          return
        }
        if (waiting && restoredWhileWaiting) return
        restoredWhileWaiting = waiting
        if (!waiting) stopObservingLayout()
        // To the saved sentence at the reading line when there is one; the
        // saved share of the body otherwise.
        const line = sentence?.()?.getBoundingClientRect()
        const delta = line?.height
          ? line.top - window.innerHeight * READING_LINE
          : scrollDeltaFor(position, bounds, window.innerHeight)
        window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' })
        // Correct once more when the remaining eager images settle, unless
        // the reader starts scrolling first.
        if (!waiting)
          frame = requestAnimationFrame(() => {
            frame = 0
            finish()
          })
      })
    }

    if (position && root) {
      resize.observe(root)
      root.addEventListener('load', restore, true)
      root.addEventListener('error', restore, true)
      window.addEventListener('wheel', cancelRestore, { passive: true })
      window.addEventListener('touchmove', cancelRestore, { passive: true })
      window.addEventListener('pointerdown', cancelRestore, { passive: true })
      window.addEventListener('keydown', onKeyDown)
      restore()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    return () => {
      save()
      clearTimeout(saveTimer)
      cancelAnimationFrame(frame)
      stopObservingLayout()
      window.removeEventListener('wheel', cancelRestore)
      window.removeEventListener('touchmove', cancelRestore)
      window.removeEventListener('pointerdown', cancelRestore)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
    }
    // `body`, `onRestored`, `onSave` and `sentence` are read once per article.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
}
