'use client'

import { useCallback, useLayoutEffect, useState } from 'react'

const seenKey = 'quilltip.landing-opening-seen.v1'

/**
 * The reader is already acting: something has focus, or a press is under
 * way (for example on the reading link, before the scripts ran). Starting
 * the opening would take that focus or press from them (#598).
 */
function readerHasStarted() {
  const focused = document.activeElement
  return (
    (focused !== null &&
      focused !== document.body &&
      focused !== document.documentElement) ||
    document.querySelector(':active') !== null
  )
}

export function useLandingOpening() {
  const [active, setActive] = useState(false)
  const finish = useCallback(() => {
    try {
      sessionStorage.setItem(seenKey, '1')
    } catch {
      /* Playback also works without storage. */
    }
    setActive(false)
  }, [])

  useLayoutEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let seen = false
    try {
      seen = sessionStorage.getItem(seenKey) === '1'
    } catch {
      /* Storage is optional. */
    }
    const back =
      (
        performance.getEntriesByType('navigation')[0] as
          | PerformanceNavigationTiming
          | undefined
      )?.type === 'back_forward'
    if (
      !media.matches &&
      !seen &&
      !location.hash &&
      !back &&
      window.scrollY === 0 &&
      !readerHasStarted() &&
      typeof Element.prototype.animate === 'function'
    )
      setActive(true)
    const change = () => {
      if (media.matches) finish()
    }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [finish])

  return { active, finish }
}
