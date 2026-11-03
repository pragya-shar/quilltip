'use client'

import { useEffect } from 'react'
import {
  readReadingProgress,
  saveReadingProgress,
  type ReadingPosition,
} from '@/lib/articles/readingProgress'

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
    function restore() {
      const body = prose()
      if (!body || !position || !body.getBoundingClientRect().height) return
      observer.disconnect()
      resize.disconnect()
      frame = requestAnimationFrame(() => {
        const bounds = body.getBoundingClientRect()
        if (isReload) restoredDocumentReload = true
        // With the prose still below the top of the viewport, use the saved
        // visible fraction to avoid jumping farther than the reader had read.
        const delta = position.offset
          ? bounds.top + bounds.height * position.offset
          : bounds.top + bounds.height * position.ratio - window.innerHeight
        window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' })
        frame = requestAnimationFrame(() => {
          restoring = false
        })
      })
    }

    if (position) {
      observer.observe(document.body, { childList: true, subtree: true })
      const content = document.querySelector('.article-content')
      if (content) resize.observe(content)
      restore()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('pagehide', save)
    return () => {
      save()
      clearTimeout(saveTimer)
      cancelAnimationFrame(frame)
      observer.disconnect()
      resize.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pagehide', save)
    }
  }, [id])
}
