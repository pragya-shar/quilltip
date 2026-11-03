'use client'

import { useEffect } from 'react'
import {
  readReadingProgress,
  saveReadingProgress,
  type ReadingPosition,
} from '@/lib/articles/readingProgress'

const IMAGE_LAYOUT_WAIT_MS = 2000
const scrollKeys = new Set([
  ' ',
  'ArrowDown',
  'ArrowUp',
  'PageDown',
  'PageUp',
  'Home',
  'End',
])

let restoredDocumentReload = false

export function useReadingPosition(id: string) {
  useEffect(() => {
    const path = location.pathname
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    const isReload =
      !restoredDocumentReload &&
      navigation?.type === 'reload' &&
      new URL(navigation.name).pathname === path
    const requested =
      (isReload ||
        new URLSearchParams(location.search).get('resume') === '1') &&
      !location.hash
    const position = requested
      ? readReadingProgress().find((entry) => entry.id === id)
      : undefined
    if (isReload && !position) restoredDocumentReload = true
    let restoring = Boolean(position)
    let frame = 0
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let pending: ReadingPosition | undefined
    let imageTimer: ReturnType<typeof setTimeout> | undefined
    let imageWaitExpired = false
    let restoredWhileWaiting = false
    const content = document.querySelector('.article-content')
    const prose = () =>
      document.querySelector<HTMLElement>('.article-content .published-prose')

    const save = () => {
      if (pending) saveReadingProgress(pending)
      pending = undefined
    }

    const onScroll = () => {
      if (restoring || location.pathname !== path || window.scrollY <= 0) return
      const bounds = prose()?.getBoundingClientRect()
      if (!bounds?.height) return
      pending = {
        id,
        ratio: (window.innerHeight - bounds.top) / bounds.height,
        offset: Math.max(0, Math.min(1, -bounds.top / bounds.height)),
      }
      clearTimeout(saveTimer)
      saveTimer = setTimeout(save, 150)
    }
    const observer = new MutationObserver(restore)
    const resize = new ResizeObserver(restore)
    function stopObservingLayout() {
      observer.disconnect()
      resize.disconnect()
      content?.removeEventListener('load', restore, true)
      content?.removeEventListener('error', restore, true)
      clearTimeout(imageTimer)
    }

    function cancelRestore() {
      if (!restoring) return
      stopObservingLayout()
      cancelAnimationFrame(frame)
      if (isReload) restoredDocumentReload = true
      restoring = false
    }

    function onKeyDown(event: KeyboardEvent) {
      if (scrollKeys.has(event.key)) cancelRestore()
    }

    function restore() {
      if (!restoring || !position || frame) return
      // TipTap may mount its prose before React mounts its image node views.
      // Let the editor commit the node views before measuring.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = 0
          if (!restoring) return
          const body = prose()
          const bounds = body?.getBoundingClientRect()
          if (!body || !bounds?.height) return

          const waiting = Array.from(body.querySelectorAll('img')).some(
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
          if (isReload) restoredDocumentReload = true
          // With the prose still below the top of the viewport, use the saved
          // visible fraction to avoid jumping farther than the reader had read.
          const delta = position.offset
            ? bounds.top + bounds.height * position.offset
            : bounds.top + bounds.height * position.ratio - window.innerHeight
          window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' })
          // Let readers start after a bounded wait; correct once when the
          // remaining eager images settle, unless the reader starts scrolling.
          if (!waiting) {
            frame = requestAnimationFrame(() => {
              frame = 0
              restoring = false
            })
          }
        })
      })
    }

    if (position) {
      observer.observe(document.body, { childList: true, subtree: true })
      if (content) {
        resize.observe(content)
        content.addEventListener('load', restore, true)
        content.addEventListener('error', restore, true)
      }
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
  }, [id])
}
