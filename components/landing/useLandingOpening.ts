'use client'

import { useCallback, useLayoutEffect, useState } from 'react'

const seenKey = 'quilltip.landing-opening-seen.v1'

/**
 * The reader is already on the hero's reading link: it has focus, or a press
 * on it is under way (both can begin before the scripts run). Starting the
 * opening would move focus to "Skip opening" and make the link inert, so the
 * opening is left out for this load and Enter or the release opens the
 * article list (#598). Focus anywhere else is left to the opening as before.
 */
function readerOnReadingLink() {
  const link = document.querySelector('.hero-actions a[href="/articles"]')
  return (
    link !== null &&
    (document.activeElement === link || link.matches(':active'))
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
      !readerOnReadingLink() &&
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
